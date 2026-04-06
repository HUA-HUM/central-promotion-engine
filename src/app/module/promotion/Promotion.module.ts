import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { PromotionsController } from '@app/controller/promotions/PromotionsController';
import { AppConfigService } from '@app/drivers/config/AppConfigService';
import { NestMercadolibreApiRepository } from '@app/drivers/NestMercadolibreApiRepository';
import { NestPriceApiRepository } from '@app/drivers/NestPriceApiRepository';
import { MongoPromotionRepository } from '@app/drivers/repositories/mongo/MongoPromotionRepository';
import { MongoModule } from '@app/module/Mongo.module';
import { PromotionAutomationService } from '@app/service/PromotionAutomation.service';
import { ActivatePromotions } from '@core/interactors/promotion/ActivatePromotions';
import { DeactivatePromotions } from '@core/interactors/promotion/DeactivatePromotions';
import { GetPromotions } from '@core/interactors/promotion/GetPromotions';
import { SaveAllPromotion } from '@core/interactors/promotion/SaveAllPromotion';
import { SyncAllPromotions } from '@core/interactors/promotion/SyncAllPromotions';

@Module({
  imports: [HttpModule, MongoModule],
  controllers: [PromotionsController],
  providers: [
    AppConfigService,
    MongoPromotionRepository,
    NestMercadolibreApiRepository,
    NestPriceApiRepository,
    PromotionAutomationService,
    {
      provide: 'SaveAllPromotion',
      useFactory: async (promotionRepository: MongoPromotionRepository) =>
        new SaveAllPromotion({
          promotionRepository,
        }),
      inject: [MongoPromotionRepository],
    },
    {
      provide: 'GetPromotions',
      useFactory: async (promotionRepository: MongoPromotionRepository) =>
        new GetPromotions({
          promotionRepository,
        }),
      inject: [MongoPromotionRepository],
    },
    {
      provide: 'SyncAllPromotions',
      useFactory: async (
        mercadolibreApiRepository: NestMercadolibreApiRepository,
        priceApiRepository: NestPriceApiRepository,
        saveAllPromotion: SaveAllPromotion,
        configService: AppConfigService,
      ) =>
        new SyncAllPromotions({
          mercadolibreApiRepository,
          priceApiRepository,
          saveAllPromotion,
          config: configService.get(),
        }),
      inject: [
        NestMercadolibreApiRepository,
        NestPriceApiRepository,
        'SaveAllPromotion',
        AppConfigService,
      ],
    },
    {
      provide: 'ActivatePromotions',
      useFactory: async (
        promotionRepository: MongoPromotionRepository,
        mercadolibreApiRepository: NestMercadolibreApiRepository,
        configService: AppConfigService,
      ) =>
        new ActivatePromotions({
          promotionRepository,
          mercadolibreApiRepository,
          config: configService.get(),
        }),
      inject: [
        MongoPromotionRepository,
        NestMercadolibreApiRepository,
        AppConfigService,
      ],
    },
    {
      provide: 'DeactivatePromotions',
      useFactory: async (
        promotionRepository: MongoPromotionRepository,
        mercadolibreApiRepository: NestMercadolibreApiRepository,
        priceApiRepository: NestPriceApiRepository,
        configService: AppConfigService,
      ) =>
        new DeactivatePromotions({
          promotionRepository,
          mercadolibreApiRepository,
          priceApiRepository,
          config: configService.get(),
        }),
      inject: [
        MongoPromotionRepository,
        NestMercadolibreApiRepository,
        NestPriceApiRepository,
        AppConfigService,
      ],
    },
  ],
})
export class PromotionModule {}
