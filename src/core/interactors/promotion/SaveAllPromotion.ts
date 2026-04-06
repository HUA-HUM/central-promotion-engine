import { PromotionRepository } from '@core/adapters/repositories/IPromotionRepository';
import { Promotion } from '@core/entities/Promotion';

export interface SaveAllPromotionBuilder {
  promotionRepository: PromotionRepository;
}

export class SaveAllPromotion {
  constructor(private readonly builder: SaveAllPromotionBuilder) {}

  async saveAll(promotions: Promotion[]): Promise<void> {
    await this.builder.promotionRepository.saveAll(promotions);
  }
}
