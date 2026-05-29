import { Module } from '@nestjs/common';
import { OpenSearchModule } from '@platform/shared/opensearch';
import { ProductIndexerService } from './indexer/product-indexer.service';
import { SearchResolver } from './search/search.resolver';
import { SearchService } from './search/search.service';

@Module({
  imports: [OpenSearchModule],
  providers: [ProductIndexerService, SearchService, SearchResolver],
  exports: [SearchService],
})
export class SearchModule {}
