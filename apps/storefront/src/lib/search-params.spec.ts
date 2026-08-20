import { PAGE_SIZE_FOR_DISPLAY, parseSearchParams, urlWithOverrides } from './search-params';

/**
 * The URL is the storefront's state container: every browse page is a pure
 * function of it. These tests pin that contract, because the URL is also the
 * part users share, bookmark, and land on from search engines — a silent
 * change to how `?page=` or `?sort=` is read breaks links that already exist
 * in the wild.
 *
 * They also pin the shape handed to the api. `parseSearchParams` is the only
 * place the storefront constructs a SearchInput, so if the generated
 * variables type drifts, these are the tests that fail first.
 */
describe('parseSearchParams', () => {
  it('requests facet counts for every facet the sidebar renders', () => {
    const { variables } = parseSearchParams({});
    expect(variables.input.facets).toEqual(['color', 'size', 'brand']);
  });

  it('sends no cursor for page 1 and an offset cursor thereafter', () => {
    expect(parseSearchParams({}).variables.input.cursor).toBeUndefined();
    expect(parseSearchParams({ page: '1' }).variables.input.cursor).toBeUndefined();
    expect(parseSearchParams({ page: '3' }).variables.input.cursor).toBe(
      String(2 * PAGE_SIZE_FOR_DISPLAY),
    );
  });

  it('treats junk and out-of-range page values as page 1', () => {
    for (const page of ['0', '-4', 'banana', '']) {
      const parsed = parseSearchParams({ page });
      expect(parsed.page).toBe(1);
      expect(parsed.variables.input.cursor).toBeUndefined();
    }
  });

  it('ORs multiple values within one facet attribute', () => {
    const { variables, selections } = parseSearchParams({ color: ['blue', 'red'] });
    expect(variables.input.filters).toContainEqual({
      attribute: 'color',
      in: ['blue', 'red'],
    });
    expect(selections.get('color')).toEqual(new Set(['blue', 'red']));
  });

  it('accepts a single-valued facet param as a one-element list', () => {
    const { variables } = parseSearchParams({ brand: 'Acme' });
    expect(variables.input.filters).toContainEqual({ attribute: 'brand', in: ['Acme'] });
  });

  it('collapses a price range into one filter carrying both bounds', () => {
    const { variables, priceMin, priceMax } = parseSearchParams({
      'price-min': '10',
      'price-max': '99.5',
    });
    expect(priceMin).toBe(10);
    expect(priceMax).toBe(99.5);
    const priceFilters = (variables.input.filters ?? []).filter(
      (f) => f.attribute === 'price',
    );
    expect(priceFilters).toEqual([{ attribute: 'price', gte: 10, lte: 99.5 }]);
  });

  it('emits a half-open range when only one bound is given', () => {
    const { variables } = parseSearchParams({ 'price-max': '50' });
    expect(variables.input.filters).toContainEqual({ attribute: 'price', lte: 50 });
  });

  it('ignores negative and non-numeric prices rather than sending them', () => {
    const { variables, priceMin } = parseSearchParams({ 'price-min': '-5' });
    expect(priceMin).toBeNull();
    expect((variables.input.filters ?? []).some((f) => f.attribute === 'price')).toBe(false);
  });

  it('only filters on stock when the toggle is explicitly on', () => {
    expect(parseSearchParams({ in_stock: '1' }).inStockOnly).toBe(true);
    expect(parseSearchParams({ in_stock: '0' }).inStockOnly).toBe(false);
    expect(parseSearchParams({}).inStockOnly).toBe(false);
  });

  it('maps sort keys onto the api enum and falls back to RELEVANCE', () => {
    expect(parseSearchParams({ sort: 'price-asc' }).variables.input.sort).toBe('PRICE_ASC');
    expect(parseSearchParams({ sort: 'name-asc' }).variables.input.sort).toBe('NAME_ASC');
    expect(parseSearchParams({ sort: 'nonsense' }).variables.input.sort).toBe('RELEVANCE');
    expect(parseSearchParams({}).variables.input.sort).toBe('RELEVANCE');
  });

  it('pins the category as an equality filter when browsing a category route', () => {
    const { variables } = parseSearchParams({}, 'headphones');
    expect(variables.input.filters).toContainEqual({
      attribute: 'category',
      eq: 'headphones',
    });
  });

  it('defaults the view to grid', () => {
    expect(parseSearchParams({}).view).toBe('grid');
    expect(parseSearchParams({ view: 'list' }).view).toBe('list');
    expect(parseSearchParams({ view: 'mosaic' }).view).toBe('grid');
  });
});

describe('urlWithOverrides', () => {
  it('keeps existing state while changing one key', () => {
    const url = urlWithOverrides('/', { color: 'blue', sort: 'relevance' }, { sort: 'price-asc' });
    expect(url).toContain('color=blue');
    expect(url).toContain('sort=price-asc');
    expect(url).not.toContain('sort=relevance');
  });

  it('drops a key when the override is null', () => {
    const url = urlWithOverrides('/', { q: 'shirt', page: '4' }, { page: null });
    expect(url).toBe('/?q=shirt');
  });

  it('preserves repeated values for multi-select facets', () => {
    const url = urlWithOverrides('/', { size: ['S', 'M'] }, {});
    expect(url).toBe('/?size=S&size=M');
  });

  it('returns the bare path when nothing survives', () => {
    expect(urlWithOverrides('/c/phones', { page: '2' }, { page: null })).toBe('/c/phones');
  });
});
