import { BadRequestException, Injectable } from '@nestjs/common';
import { EventBus } from '@platform/shared/event-bus';
import {
  ATTRIBUTE_TYPES,
  CATALOG_EVENTS,
  type AttributeDefinition,
  type AttributeType,
  type CreateAttributeDefinitionDto,
} from '@platform/modules/catalog/contracts';
import { randomUUID } from 'node:crypto';
import { AttributeDefinitionsRepository } from './attribute-definitions.repository';

const CODE_PATTERN = /^[a-z][a-z0-9_]*$/;

@Injectable()
export class AttributeDefinitionsService {
  constructor(
    private readonly repo: AttributeDefinitionsRepository,
    private readonly events: EventBus,
  ) {}

  async create(
    tenantId: string,
    dto: CreateAttributeDefinitionDto,
  ): Promise<AttributeDefinition> {
    if (!dto?.code || !CODE_PATTERN.test(dto.code)) {
      throw new BadRequestException(
        `attribute code must match ${CODE_PATTERN.source}`,
      );
    }
    if (!ATTRIBUTE_TYPES.includes(dto.type as AttributeType)) {
      throw new BadRequestException(
        `attribute type must be one of ${ATTRIBUTE_TYPES.join('|')}`,
      );
    }

    const config = (dto.config ?? {}) as Record<string, unknown>;
    if (dto.type === 'enum') {
      const allowed = config['allowedValues'];
      if (!Array.isArray(allowed) || allowed.length === 0 || !allowed.every((v) => typeof v === 'string')) {
        throw new BadRequestException(
          'enum attribute requires config.allowedValues: non-empty string[]',
        );
      }
    }

    const existing = await this.repo.findByCode(tenantId, dto.code);
    if (existing) {
      throw new BadRequestException(`attribute "${dto.code}" already defined for this tenant`);
    }

    const created = await this.repo.insert({
      tenantId,
      code: dto.code,
      type: dto.type,
      multiValue: dto.multiValue ?? false,
      config,
    });

    await this.events.publish({
      name: CATALOG_EVENTS.AttributeDefinitionCreated,
      eventId: randomUUID(),
      occurredAt: new Date().toISOString(),
      tenantId,
      payload: { definition: created } as never,
    });

    return created;
  }

  list(tenantId: string): Promise<readonly AttributeDefinition[]> {
    return this.repo.listByTenant(tenantId);
  }
}
