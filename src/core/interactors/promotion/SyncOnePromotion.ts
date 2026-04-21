import { MercadolibreApiRepository } from '@core/adapters/repositories/IMercadolibreApiRepository';
import { ProcessResult } from '@core/adapters/dto/ProcessResult';
import {
  SyncAllPromotions,
  SyncAllPromotionsInput,
} from '@core/interactors/promotion/SyncAllPromotions';

export interface SyncOnePromotionInput {
  promotionId: string;
  sourceProcess: string;
  updatedBy: string;
}

export interface SyncOnePromotionBuilder {
  mercadolibreApiRepository: MercadolibreApiRepository;
  syncAllPromotions: SyncAllPromotions;
}

export class SyncOnePromotion {
  constructor(private readonly builder: SyncOnePromotionBuilder) {}

  async execute(input: SyncOnePromotionInput): Promise<ProcessResult> {
    const promotionCatalogs = await this.builder.mercadolibreApiRepository.getPromotions();
    const promotionCatalog = promotionCatalogs.find(
      (catalog) => catalog.promotionId === input.promotionId,
    );

    if (!promotionCatalog) {
      throw new Error(`Promotion catalog ${input.promotionId} not found`);
    }

    const processInput: SyncAllPromotionsInput = {
      sourceProcess: input.sourceProcess,
      updatedBy: input.updatedBy,
    };

    return this.builder.syncAllPromotions.syncPromotionCatalogs(
      [promotionCatalog],
      processInput,
      'sync-one',
    );
  }
}
