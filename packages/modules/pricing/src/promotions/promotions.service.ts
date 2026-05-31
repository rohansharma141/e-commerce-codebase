import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type {
  CreatePromotionDto,
  Promotion,
  UpdatePromotionDto,
} from '@platform/modules/pricing/contracts';
import { PromotionsRepository } from './promotions.repository';

const CODE_PATTERN = /^[A-Z0-9_-]{3,32}$/;

@Injectable()
export class PromotionsService {
  constructor(private readonly repo: PromotionsRepository) {}

  async create(tenantId: string, dto: CreatePromotionDto): Promise<Promotion> {
    if (dto.kind !== 'coupon-code' && dto.kind !== 'automatic') {
      throw new BadRequestException('kind must be coupon-code or automatic');
    }
    if (dto.kind === 'coupon-code') {
      if (!dto.code || !CODE_PATTERN.test(dto.code)) {
        throw new BadRequestException(
          `coupon-code promotions require a code matching ${CODE_PATTERN.source}`,
        );
      }
    }
    validateCondition(dto);
    validateAction(dto);

    return this.repo.insert({
      tenantId,
      kind: dto.kind,
      code: dto.kind === 'coupon-code' ? dto.code ?? null : null,
      condition: dto.condition,
      action: dto.action,
      expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
      maxUses: dto.maxUses ?? null,
      active: dto.active ?? true,
    });
  }

  async list(tenantId: string): Promise<readonly Promotion[]> {
    return this.repo.listByTenant(tenantId);
  }

  async update(tenantId: string, id: string, dto: UpdatePromotionDto): Promise<Promotion> {
    const updated = await this.repo.update(tenantId, id, {
      active: dto.active,
      expiresAt: dto.expiresAt === undefined ? undefined : dto.expiresAt === null ? null : new Date(dto.expiresAt),
      maxUses: dto.maxUses === undefined ? undefined : dto.maxUses,
      action: dto.action,
    });
    if (!updated) throw new NotFoundException();
    return updated;
  }
}

function validateCondition(dto: CreatePromotionDto): void {
  switch (dto.condition.type) {
    case 'always':
      break;
    case 'cart-total-min': {
      const min = (dto.condition.value as { minCents?: unknown })['minCents'];
      if (typeof min !== 'number' || !Number.isInteger(min) || min <= 0) {
        throw new BadRequestException('cart-total-min condition requires { minCents: positive int }');
      }
      break;
    }
    case 'contains-product': {
      const productId = (dto.condition.value as { productId?: unknown })['productId'];
      if (typeof productId !== 'string' || productId.length === 0) {
        throw new BadRequestException('contains-product condition requires { productId: string }');
      }
      break;
    }
    default:
      throw new BadRequestException('unknown condition type');
  }
}

function validateAction(dto: CreatePromotionDto): void {
  if (!Number.isInteger(dto.action.value) || dto.action.value <= 0) {
    throw new BadRequestException('action.value must be a positive integer');
  }
  if (dto.action.type === 'percent' && dto.action.value > 10_000) {
    throw new BadRequestException('percent action value (bps) cannot exceed 10000 (100%)');
  }
}
