import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Injectable, Logger } from '@nestjs/common';
import type { PostgresClient } from './pool';

export interface MigrationResult {
  readonly schemaName: string;
  readonly applied: readonly string[];
  readonly skipped: readonly string[];
}

/**
 * Per-module migration runner. Each module owns its own Postgres schema and a
 * ledger table inside that schema (__migrations), so module extraction is just
 * "copy the schema + its ledger" — no global migrations table to fight.
 */
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

    await this.sql.unsafe(`CREATE SCHEMA IF NOT EXISTS "${schemaName}"`);
    await this.sql.unsafe(`
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

      const existing = await this.sql<
        { filename: string; checksum: string }[]
      >`SELECT filename, checksum FROM ${this.sql(`${schemaName}.__migrations`)} WHERE filename = ${file}`;

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

      await this.sql.begin(async (tx) => {
        await tx.unsafe(contents);
        await tx`INSERT INTO ${tx(`${schemaName}.__migrations`)} (filename, checksum) VALUES (${file}, ${checksum})`;
      });

      applied.push(file);
      this.logger.log(`Applied ${schemaName}/${file}`);
    }

    if (applied.length === 0) {
      this.logger.log(`${schemaName}: no new migrations (${skipped.length} already applied)`);
    } else {
      this.logger.log(`${schemaName}: applied ${applied.length} migration(s)`);
    }

    return { schemaName, applied, skipped };
  }
}

function isSafeIdentifier(name: string): boolean {
  return /^[a-z_][a-z0-9_]*$/i.test(name);
}
