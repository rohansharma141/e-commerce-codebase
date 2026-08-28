import { ApiProperty } from '@nestjs/swagger';
import type * as Contract from '@platform/modules/catalog/contracts';

/**
 * The catalog module's HTTP representation.
 *
 * Same reasoning as `cart.schema.ts`, `orders.schema.ts` and
 * `pricing.schema.ts`: `@nestjs/swagger` reads decorator metadata, interfaces
 * leave none, so without these the admin attribute endpoints document as `{}`.
 *
 * In `src/` rather than `contracts/` on purpose — the contracts packages have
 * zero dependencies and `@ApiProperty` would put `@nestjs/swagger` inside the
 * surface a consumer imports. `implements Contract.X` is the guard that keeps
 * the class from drifting from the interface.
 */

export class Product implements Contract.Product {
  @ApiProperty({ format: 'uuid' })
  readonly id!: string;

  @ApiProperty({ example: 't-fashion' })
  readonly tenantId!: string;

  @ApiProperty({ example: 'T-FASHION-0000286' })
  readonly sku!: string;

  @ApiProperty({ example: 'Vesper Oxford Shirt' })
  readonly name!: string;

  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    description:
      'Tenant-defined attribute values, keyed by attribute code. The keys are whatever this tenant has defined, so the schema is open by design rather than by omission.',
    example: { color: 'blue', size: 'M', in_stock: true },
  })
  readonly attributes!: Contract.ProductAttributes;

  @ApiProperty({ format: 'date-time' })
  readonly createdAt!: string;

  @ApiProperty({ format: 'date-time' })
  readonly updatedAt!: string;
}

export class ProductListResponse implements Contract.ListProductsResult {
  @ApiProperty({ type: () => [Product] })
  readonly items!: readonly Product[];

  @ApiProperty({
    type: String,
    nullable: true,
    description:
      'Opaque token for the next page, or null on the last page. Pass it back as ?cursor=. Do not parse it — the sort key is `id`.',
  })
  readonly nextCursor!: string | null;
}

export class AttributeDefinition implements Contract.AttributeDefinition {
  @ApiProperty({ format: 'uuid' })
  readonly id!: string;

  @ApiProperty({ example: 't-fashion' })
  readonly tenantId!: string;

  @ApiProperty({
    example: 'color',
    description: 'Tenant-scoped identifier, matching /^[a-z][a-z0-9_]*$/ and unique per tenant.',
  })
  readonly code!: string;

  @ApiProperty({ enum: ['string', 'number', 'boolean', 'enum', 'date'] })
  readonly type!: Contract.AttributeType;

  @ApiProperty({ description: 'Whether a product may carry several values for this attribute.' })
  readonly multiValue!: boolean;

  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    description:
      'Validation rules, shaped by `type`: string:{maxLength?} | number:{min?,max?} | enum:{allowedValues} | boolean:{} | date:{}.',
    example: { allowedValues: ['black', 'white', 'red'] },
  })
  // A discriminated union keyed on `type`. OpenAPI 3.0 can express this as a
  // oneOf with a discriminator, but the generated client would then need a
  // narrowing step for a payload every consumer treats as opaque config. An
  // open object is the honest description of what a client can rely on.
  readonly config!: Contract.AttributeConfigByType[Contract.AttributeType];

  @ApiProperty({ format: 'date-time' })
  readonly createdAt!: string;
}

export class AttributeDefinitionListResponse {
  @ApiProperty({ type: () => [AttributeDefinition] })
  readonly items!: readonly AttributeDefinition[];

  @ApiProperty({
    type: String,
    nullable: true,
    description:
      'Opaque token for the next page, or null on the last page. Pass it back as ?cursor=. Do not parse it — the sort key is `code`.',
  })
  readonly nextCursor!: string | null;
}
