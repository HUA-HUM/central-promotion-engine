import { PriceApiRepository } from '@core/adapters/repositories/IPriceApiRepository';
import { PromotionType } from '@core/entities/PromotionCatalog';
import { DealPromotion } from '@core/interactors/promotion/models/DealPromotion';
import { PreNegotiatedPromotion } from '@core/interactors/promotion/models/PreNegotiatedPromotion';
import {
  GenericPromotion,
  PromotionModel,
  PromotionBuilderDependencies,
} from '@core/interactors/promotion/models/Promotion';
import { SmartPromotion } from '@core/interactors/promotion/models/SmartPromotion';

export class PromotionModelsRegistry {
  private readonly modelsByType = new Map<PromotionType, PromotionModel>();
  private readonly genericModel: PromotionModel;

  private constructor(models: PromotionModel[], genericModel: PromotionModel) {
    this.genericModel = genericModel;
    for (const model of models) {
      this.modelsByType.set(model.type, model);
    }
  }

  static forActivation(): PromotionModelsRegistry {
    const models: PromotionModel[] = [
      new DealPromotion(),
      new SmartPromotion(),
      new PreNegotiatedPromotion(),
    ];

    return new PromotionModelsRegistry(models, new GenericPromotion());
  }

  static forSync(priceApiRepository: PriceApiRepository): PromotionModelsRegistry {
    const dependencies: PromotionBuilderDependencies = { priceApiRepository };
    const models: PromotionModel[] = [
      new DealPromotion(dependencies),
      new SmartPromotion(dependencies),
      new PreNegotiatedPromotion(dependencies),
    ];

    return new PromotionModelsRegistry(models, new GenericPromotion(dependencies));
  }

  resolve(type: PromotionType): PromotionModel {
    return this.modelsByType.get(type) ?? this.genericModel;
  }
}
