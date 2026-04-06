import {
  PromotionFilters,
  PromotionRepository,
} from '@core/adapters/repositories/IPromotionRepository';
import { Promotion } from '@core/entities/Promotion';

export interface GetPromotionsBuilder {
  promotionRepository: PromotionRepository;
}

export class GetPromotions {
  constructor(private readonly builder: GetPromotionsBuilder) {}

  async findWithFilters(filters: PromotionFilters): Promise<Promotion[]> {
    return this.builder.promotionRepository.findAll(filters);
  }
}
