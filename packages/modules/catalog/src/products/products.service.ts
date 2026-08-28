import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { EventBus } from '@platform/shared/event-bus';
import { HOOK_NAMES, HookRegistry } from '@platform/shared/hooks';
import { currentTenantOrThrow } from '@platform/shared/tenant-context';
import {
  CATALOG_EVENTS,
  type CreateProductDto,
  type ListProductsQuery,
  type ListProductsResult,
  type Product,
  type UpdateProductDto,
} from '@platform/modules/catalog/contracts';
import { ProductsRepository } from './products.repository';
import { AttributeValidator } from './attribute-validator';

const SKU_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;

@Injectable()
export class ProductsService {
  constructor(
    private readonly repo: ProductsRepository,
    private readonly validator: AttributeValidator,
    private readonly events: EventBus,
    private readonly hooks: HookRegistry,
  ) {}

  async create(tenantId: string, dto: CreateProductDto): Promise<Product> {
    if (!dto?.sku || !SKU_PATTERN.test(dto.sku)) {
      throw new BadRequestException(`sku must match ${SKU_PATTERN.source}`);
    }
    if (!dto.name || typeof dto.name !== 'string' || dto.name.trim().length === 0) {
      throw new BadRequestException('name is required');
    }

    const attrResult = await this.validator.validate(tenantId, dto.attributes);
    if (!attrResult.ok) {
      throw new BadRequestException({
        message: 'attribute validation failed',
        errors: attrResult.errors,
      });
    }

    const existing = await this.repo.findBySku(tenantId, dto.sku);
    if (existing) throw new ConflictException(`sku "${dto.sku}" already exists`);

    const created = await this.repo.insert({
      tenantId,
      sku: dto.sku,
      name: dto.name,
      attributes: attrResult.normalized,
    });

    await this.events.publish({
      name: CATALOG_EVENTS.ProductCreated,
      eventId: randomUUID(),
      occurredAt: new Date().toISOString(),
      tenantId,
      payload: { product: created } as never,
    });

    // Sibling extension point — events fan out to indexers etc.; hooks
    // expose a stable customisation API the platform documents.
    await this.hooks.dispatch(
      HOOK_NAMES.ProductAfterCreate,
      { id: created.id, sku: created.sku, name: created.name },
      currentTenantOrThrow(),
    );

    return created;
  }

  async getById(tenantId: string, id: string): Promise<Product> {
    const product = await this.repo.findById(tenantId, id);
    if (!product) throw new NotFoundException();
    return product;
  }

  async list(tenantId: string, query: ListProductsQuery): Promise<ListProductsResult> {
    // No `?? 20` here any more: the default page size is one of the admin
    // conventions, and clampLimit owns it so all five lists agree on 50.
    return this.repo.list(tenantId, {
      limit: query.limit,
      cursor: query.cursor,
    });
  }

  async update(tenantId: string, id: string, dto: UpdateProductDto): Promise<Product> {
    const previous = await this.repo.findById(tenantId, id);
    if (!previous) throw new NotFoundException();

    if (dto.sku !== undefined && !SKU_PATTERN.test(dto.sku)) {
      throw new BadRequestException(`sku must match ${SKU_PATTERN.source}`);
    }
    if (dto.name !== undefined && (typeof dto.name !== 'string' || dto.name.trim().length === 0)) {
      throw new BadRequestException('name must be a non-empty string');
    }

    let normalizedAttributes = previous.attributes;
    if (dto.attributes !== undefined) {
      const r = await this.validator.validate(tenantId, dto.attributes);
      if (!r.ok) {
        throw new BadRequestException({
          message: 'attribute validation failed',
          errors: r.errors,
        });
      }
      normalizedAttributes = r.normalized;
    }

    if (dto.sku !== undefined && dto.sku !== previous.sku) {
      const clash = await this.repo.findBySku(tenantId, dto.sku);
      if (clash) throw new ConflictException(`sku "${dto.sku}" already exists`);
    }

    const updated = await this.repo.update(tenantId, id, {
      sku: dto.sku,
      name: dto.name,
      attributes: dto.attributes !== undefined ? normalizedAttributes : undefined,
    });
    if (!updated) throw new NotFoundException();

    await this.events.publish({
      name: CATALOG_EVENTS.ProductUpdated,
      eventId: randomUUID(),
      occurredAt: new Date().toISOString(),
      tenantId,
      payload: { product: updated, previous } as never,
    });

    return updated;
  }

  async delete(tenantId: string, id: string): Promise<void> {
    const deleted = await this.repo.delete(tenantId, id);
    if (!deleted) throw new NotFoundException();
    await this.events.publish({
      name: CATALOG_EVENTS.ProductDeleted,
      eventId: randomUUID(),
      occurredAt: new Date().toISOString(),
      tenantId,
      payload: { product: deleted } as never,
    });
  }
}
