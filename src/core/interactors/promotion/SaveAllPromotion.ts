import { PromotionRepository } from '@core/adapters/repositories/IPromotionRepository';
import { Promotion } from '@core/entities/Promotion';
import { PromotionCatalog } from '@core/entities/PromotionCatalog';

export interface SaveAllPromotionBuilder {
  promotionRepository: PromotionRepository;
}

export class SaveAllPromotion {
  constructor(private readonly builder: SaveAllPromotionBuilder) {}

  async saveAll(promotions: Promotion[]): Promise<void> {
    await this.builder.promotionRepository.saveAll(promotions);
  }

  async saveCatalogs(catalogs: PromotionCatalog[]): Promise<void> {
    await this.builder.promotionRepository.saveCatalogs(catalogs);
  }
}
