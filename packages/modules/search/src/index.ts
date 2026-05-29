// Public surface of the search module. Apps consume `SearchModule` for wiring;
// the seed CLI also reuses the document/mapping transforms so it stays on the
// same code paths the live indexer uses.
export { SearchModule } from './search.module';
export {
  attributeFieldName,
  attributePropertiesFor,
  buildMapping,
  osTypeFor,
  BASE_PROPERTIES,
} from './indexer/mapping-manager';
export { productToDocument } from './indexer/document-builder';
