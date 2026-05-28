import type { AttributeType } from './attribute-types';

export interface CreateAttributeDefinitionDto {
  readonly code: string;
  readonly type: AttributeType;
  readonly multiValue?: boolean;
  readonly config?: Record<string, unknown>;
}
