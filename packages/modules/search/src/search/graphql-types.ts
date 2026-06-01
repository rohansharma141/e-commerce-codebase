import { Field, InputType, Int, ObjectType, registerEnumType } from '@nestjs/graphql';
import { GraphQLJSON } from 'graphql-scalars';

export enum SortOptionEnum {
  RELEVANCE = 'RELEVANCE',
  PRICE_ASC = 'PRICE_ASC',
  PRICE_DESC = 'PRICE_DESC',
  NAME_ASC = 'NAME_ASC',
}
registerEnumType(SortOptionEnum, { name: 'SortOption' });

@InputType()
export class AttributeFilterInput {
  @Field(() => String)
  attribute!: string;

  @Field(() => String, { nullable: true })
  eq?: string;

  @Field(() => Number, { nullable: true })
  gte?: number;

  @Field(() => Number, { nullable: true })
  lte?: number;

  @Field(() => [String], { nullable: true })
  in?: string[];
}

@InputType()
export class SearchInput {
  @Field(() => String, { nullable: true })
  query?: string;

  @Field(() => [AttributeFilterInput], { nullable: true })
  filters?: AttributeFilterInput[];

  @Field(() => [String], { nullable: true })
  facets?: string[];

  @Field(() => Int, { nullable: true, defaultValue: 20 })
  limit?: number;

  @Field(() => String, { nullable: true })
  cursor?: string;

  @Field(() => SortOptionEnum, { nullable: true, defaultValue: SortOptionEnum.RELEVANCE })
  sort?: SortOptionEnum;

  @Field(() => Boolean, { nullable: true, defaultValue: false })
  autocomplete?: boolean;
}

@ObjectType()
export class FacetBucketType {
  @Field(() => String) value!: string;
  @Field(() => Int) count!: number;
}

@ObjectType()
export class FacetType {
  @Field(() => String) attribute!: string;
  @Field(() => [FacetBucketType]) buckets!: FacetBucketType[];
}

@ObjectType()
export class ProductHitType {
  @Field(() => String) id!: string;
  @Field(() => String) sku!: string;
  @Field(() => String) name!: string;
  @Field(() => GraphQLJSON) attributes!: Record<string, unknown>;
}

@ObjectType()
export class SearchResultType {
  @Field(() => [ProductHitType]) items!: ProductHitType[];
  @Field(() => [FacetType]) facets!: FacetType[];
  @Field(() => Int) total!: number;
  @Field(() => String, { nullable: true }) nextCursor!: string | null;
  @Field(() => Int) latencyMs!: number;
}
