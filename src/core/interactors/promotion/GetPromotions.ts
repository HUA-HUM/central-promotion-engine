import {
  PaginatedPromotionsResult,
  PromotionFilters,
  PromotionRepository,
} from '@core/adapters/repositories/IPromotionRepository';

export interface GetPromotionsBuilder {
  promotionRepository: PromotionRepository;
}

export class GetPromotions {
  constructor(private readonly builder: GetPromotionsBuilder) {}

  async findWithFilters(filters: PromotionFilters): Promise<PaginatedPromotionsResult> {
    return this.builder.promotionRepository.findAll(filters);
  }
}
