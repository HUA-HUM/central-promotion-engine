import { PromotionRepository, PromotionStatsResult } from '@core/adapters/repositories/IPromotionRepository';

export interface GetPromotionStatsBuilder {
  promotionRepository: PromotionRepository;
}

export class GetPromotionStats {
  constructor(private readonly builder: GetPromotionStatsBuilder) {}

  async execute(): Promise<PromotionStatsResult> {
    return this.builder.promotionRepository.getStats();
  }
}
