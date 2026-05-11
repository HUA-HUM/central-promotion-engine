import {
  PaginatedPromotionCatalogsResult,
  PromotionCatalogFilters,
  PromotionRepository,
} from '@core/adapters/repositories/IPromotionRepository';

export interface GetPromotionCatalogsBuilder {
  promotionRepository: PromotionRepository;
}

export class GetPromotionCatalogs {
  constructor(private readonly builder: GetPromotionCatalogsBuilder) {}

  async findWithFilters(
    filters: PromotionCatalogFilters,
  ): Promise<PaginatedPromotionCatalogsResult> {
    return this.builder.promotionRepository.findCatalogs(filters);
  }
}
