import { buildSearchBody, nextCursorFor } from './query-builder';

describe('buildSearchBody', () => {
  it('builds a match-all when no inputs are provided', () => {
    const body = buildSearchBody({});
    expect(body.query.bool).toEqual({});
    expect(body.size).toBe(20);
    expect(body.from).toBe(0);
    expect(body.aggs).toBeUndefined();
  });

  it('attaches a text match when query is set', () => {
    const body = buildSearchBody({ query: 'red shoe' });
    expect(body.query.bool.must).toEqual([
      { match: { name: { query: 'red shoe', operator: 'and' } } },
    ]);
  });

  it('translates eq/in/range filters to OS filter clauses', () => {
    const body = buildSearchBody({
      filters: [
        { attribute: 'color', eq: 'red' },
        { attribute: 'size', in: ['M', 'L'] },
        { attribute: 'price', gte: 5, lte: 50 },
      ],
    });
    expect(body.query.bool.filter).toEqual([
      { term: { attr_color: 'red' } },
      { terms: { attr_size: ['M', 'L'] } },
      { range: { attr_price: { gte: 5, lte: 50 } } },
    ]);
  });

  it('adds terms aggregations for requested facets', () => {
    const body = buildSearchBody({ facets: ['color', 'size'] });
    expect(body.aggs?.['facet_color']).toEqual({
      terms: { field: 'attr_color', size: 50 },
    });
    expect(body.aggs?.['facet_size']).toEqual({
      terms: { field: 'attr_size', size: 50 },
    });
  });

  it('clamps limit and rejects invalid cursor', () => {
    expect(buildSearchBody({ limit: -1 }).size).toBe(20);
    expect(buildSearchBody({ limit: 999 }).size).toBe(200);
    expect(buildSearchBody({ cursor: '40' }).from).toBe(40);
    expect(() => buildSearchBody({ cursor: 'NaN' })).toThrow(/invalid cursor/);
    expect(() => buildSearchBody({ cursor: '999999999' })).toThrow(/invalid cursor/);
  });
});

describe('nextCursorFor', () => {
  it('returns null when at the end', () => {
    expect(nextCursorFor(80, 20, 100)).toBeNull();
  });
  it('returns the next offset as string when there are more results', () => {
    expect(nextCursorFor(0, 20, 100)).toBe('20');
    expect(nextCursorFor(20, 20, 100)).toBe('40');
  });
});
