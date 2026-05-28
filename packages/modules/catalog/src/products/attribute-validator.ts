import { Injectable } from '@nestjs/common';
import type {
  AttributeDefinition,
  ProductAttributes,
} from '@platform/modules/catalog/contracts';
import { AttributeDefinitionsRepository } from '../attribute-definitions/attribute-definitions.repository';

export interface AttributeValidationError {
  readonly code: string;
  readonly message: string;
}

export interface AttributeValidationResult {
  readonly ok: boolean;
  readonly errors: readonly AttributeValidationError[];
  readonly normalized: ProductAttributes;
}

/**
 * Validates a product's `attributes` map against the tenant's attribute
 * definitions. This is the central piece that distinguishes "tenant-defined
 * typed attributes" from "free-form JSONB" — without it, JSONB is just a sack
 * of mystery values.
 *
 * Reads definitions through the repository on each call. Per-request caching
 * can be layered on later; the call volume in step 2 doesn't justify it yet.
 */
@Injectable()
export class AttributeValidator {
  constructor(private readonly defsRepo: AttributeDefinitionsRepository) {}

  async validate(
    tenantId: string,
    attributes: ProductAttributes | undefined,
  ): Promise<AttributeValidationResult> {
    const errors: AttributeValidationError[] = [];
    const normalized: ProductAttributes = {};

    if (!attributes || Object.keys(attributes).length === 0) {
      return { ok: true, errors, normalized };
    }

    const defs = await this.defsRepo.listByTenant(tenantId);
    const defsByCode = new Map(defs.map((d) => [d.code, d]));

    for (const [code, value] of Object.entries(attributes)) {
      const def = defsByCode.get(code);
      if (!def) {
        errors.push({ code, message: `unknown attribute "${code}" for this tenant` });
        continue;
      }
      const result = validateValue(def, value);
      if (result.error) {
        errors.push({ code, message: result.error });
      } else {
        normalized[code] = result.value;
      }
    }

    return { ok: errors.length === 0, errors, normalized };
  }
}

interface ValueResult {
  readonly value?: unknown;
  readonly error?: string;
}

function validateValue(def: AttributeDefinition, raw: unknown): ValueResult {
  if (def.multiValue) {
    if (!Array.isArray(raw)) {
      return { error: `expected an array for multi-value attribute "${def.code}"` };
    }
    const out: unknown[] = [];
    for (const item of raw) {
      const r = validateScalar(def, item);
      if (r.error) return { error: `${def.code}[${out.length}]: ${r.error}` };
      out.push(r.value);
    }
    return { value: out };
  }
  return validateScalar(def, raw);
}

function validateScalar(def: AttributeDefinition, raw: unknown): ValueResult {
  switch (def.type) {
    case 'string':
      if (typeof raw !== 'string') return { error: `expected string` };
      return { value: raw };
    case 'number':
      if (typeof raw !== 'number' || !Number.isFinite(raw)) return { error: `expected finite number` };
      {
        const cfg = def.config as { min?: number; max?: number };
        if (typeof cfg.min === 'number' && raw < cfg.min) return { error: `value < min (${cfg.min})` };
        if (typeof cfg.max === 'number' && raw > cfg.max) return { error: `value > max (${cfg.max})` };
      }
      return { value: raw };
    case 'boolean':
      if (typeof raw !== 'boolean') return { error: `expected boolean` };
      return { value: raw };
    case 'enum': {
      if (typeof raw !== 'string') return { error: `expected string for enum` };
      const cfg = def.config as { allowedValues: readonly string[] };
      if (!cfg.allowedValues.includes(raw)) {
        return { error: `"${raw}" not in allowedValues [${cfg.allowedValues.join(',')}]` };
      }
      return { value: raw };
    }
    case 'date': {
      if (typeof raw !== 'string') return { error: `expected ISO-8601 date string` };
      const ts = Date.parse(raw);
      if (Number.isNaN(ts)) return { error: `invalid ISO-8601 date` };
      return { value: new Date(ts).toISOString() };
    }
    default:
      return { error: `unsupported attribute type "${(def as { type: string }).type}"` };
  }
}
