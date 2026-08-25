import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Injectable, Logger } from '@nestjs/common';
import type { PostgresClient } from './pool';

/** What `sql.reserve()` resolves to: a pinned connection plus release(). */
type ReservedConnection = Awaited<ReturnType<PostgresClient['reserve']>>;

export interface MigrationResult {
  readonly schemaName: string;
  readonly applied: readonly string[];
  readonly skipped: readonly string[];
}

/**
 * Per-module migration runner. Each module owns its own Postgres schema and a
 * ledger table inside that schema (__migrations), so module extraction is just
 * "copy the schema + its ledger" — no global migrations table to fight.
 *
 * Concurrency: every `apply()` runs while holding a session-level advisory
 * lock, so two migrators against the same database queue rather than collide.
 * Without it, concurrent runs race in two ways, both observed rather than
 * theorised:
 *
 *   - `CREATE EXTENSION IF NOT EXISTS` is not atomic. Two transactions both
 *     see the extension missing and both insert, and one dies on
 *     `pg_extension_name_index`. That failure aborts the whole apply, so the
 *     schema it was creating never appears and every later statement fails
 *     with "schema does not exist".
 *   - the ledger check is read-then-write. Both runners see a file as
 *     unapplied, both run it, and the second fails inserting a duplicate
 *     filename.
 *
 * The lock covers the ledger check as well as the DDL for exactly that second
 * reason — locking only the DDL would leave the check outside it.
 *
 * This is not just a test-harness concern. Two api replicas starting at the
 * same time, or a rolling deploy, hit the identical race.
 */

/**
 * Arbitrary but fixed. Any two migrators sharing a database must pick the same
 * number for the lock to mean anything; it is namespaced by database, so it
 * only has to be unique against other advisory-lock users in this app.
 */
const MIGRATION_LOCK_KEY = 8_147_231;
@Injectable()
export class MigrationRunner {
  private readonly logger = new Logger(MigrationRunner.name);

  constructor(private readonly sql: PostgresClient) {}

  async apply(migrationsDir: string, schemaName: string): Promise<MigrationResult> {
    if (!isSafeIdentifier(schemaName)) {
      throw new Error(`Unsafe schema name: ${schemaName}`);
    }

    const files = (await readdir(migrationsDir))
      .filter((f) => f.endsWith('.sql'))
      .sort();

    const applied: string[] = [];
    const skipped: string[] = [];

    // An advisory lock is session-scoped, so it has to be taken and released
    // on one specific connection rather than whichever the pool hands out.
    const conn = await this.sql.reserve();
    try {
      await conn`SELECT pg_advisory_lock(${MIGRATION_LOCK_KEY})`;
      await this.applyLocked(conn, migrationsDir, schemaName, files, applied, skipped);
    } finally {
      await conn`SELECT pg_advisory_unlock(${MIGRATION_LOCK_KEY})`;
      conn.release();
    }

    if (applied.length === 0) {
      this.logger.log(`${schemaName}: no new migrations (${skipped.length} already applied)`);
    } else {
      this.logger.log(`${schemaName}: applied ${applied.length} migration(s)`);
    }

    return { schemaName, applied, skipped };
  }

  private async applyLocked(
    conn: ReservedConnection,
    migrationsDir: string,
    schemaName: string,
    files: readonly string[],
    applied: string[],
    skipped: string[],
  ): Promise<void> {
    await conn.unsafe(`CREATE SCHEMA IF NOT EXISTS "${schemaName}"`);
    await conn.unsafe(`
      CREATE TABLE IF NOT EXISTS "${schemaName}".__migrations (
        filename text PRIMARY KEY,
        checksum text NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    for (const file of files) {
      const fullPath = join(migrationsDir, file);
      const contents = await readFile(fullPath, 'utf8');
      const checksum = createHash('sha256').update(contents).digest('hex');

      const existing = await conn<
        { filename: string; checksum: string }[]
      >`SELECT filename, checksum FROM ${conn(`${schemaName}.__migrations`)} WHERE filename = ${file}`;

      if (existing.length > 0) {
        const found = existing[0];
        if (found && found.checksum !== checksum) {
          throw new Error(
            `Migration ${schemaName}/${file} has been modified after being applied (checksum mismatch). ` +
              `Migrations are immutable once applied.`,
          );
        }
        skipped.push(file);
        continue;
      }

      // Explicit transaction control rather than `.begin()`: a reserved
      // connection doesn't expose the transaction helper, and the work has to
      // stay on this connection because that is where the advisory lock is
      // held. The migration and its ledger row commit together or not at all,
      // so a failure halfway can never leave a file recorded as applied.
      await conn.unsafe('BEGIN');
      try {
        await conn.unsafe(contents);
        await conn`INSERT INTO ${conn(`${schemaName}.__migrations`)} (filename, checksum) VALUES (${file}, ${checksum})`;
        await conn.unsafe('COMMIT');
      } catch (err) {
        await conn.unsafe('ROLLBACK');
        throw err;
      }

      applied.push(file);
      this.logger.log(`Applied ${schemaName}/${file}`);
    }
  }
}

function isSafeIdentifier(name: string): boolean {
  return /^[a-z_][a-z0-9_]*$/i.test(name);
}
