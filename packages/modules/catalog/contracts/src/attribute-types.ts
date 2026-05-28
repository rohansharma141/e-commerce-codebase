export const ATTRIBUTE_TYPES = ['string', 'number', 'boolean', 'enum', 'date'] as const;
export type AttributeType = (typeof ATTRIBUTE_TYPES)[number];

export type AttributeValue = string | number | boolean | Array<string | number | boolean>;

export interface AttributeConfigByType {
  string: { readonly maxLength?: number };
  number: { readonly min?: number; readonly max?: number };
  boolean: Record<string, never>;
  enum: { readonly allowedValues: readonly string[] };
  date: Record<string, never>;
}

export interface AttributeDefinition<T extends AttributeType = AttributeType> {
  readonly id: string;
  readonly tenantId: string;
  readonly code: string;
  readonly type: T;
  readonly multiValue: boolean;
  readonly config: AttributeConfigByType[T];
  readonly createdAt: string;
}
