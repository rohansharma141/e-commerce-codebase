import { Field, InputType, Int, ObjectType } from '@nestjs/graphql';
import { GraphQLJSON } from 'graphql-scalars';

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
