import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { PromotionsController } from '@app/controller/promotions/PromotionsController';
import { AppConfigService } from '@app/drivers/config/AppConfigService';
import { NestCampaignMlaApiRepository } from '@app/drivers/NestCampaignMlaApiRepository';
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
import { SyncOnePromotion } from '@core/interactors/promotion/SyncOnePromotion';

@Module({
  imports: [HttpModule, MongoModule],
  controllers: [PromotionsController],
  providers: [
    AppConfigService,
    MongoPromotionRepository,
    NestCampaignMlaApiRepository,
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
        campaignMlaApiRepository: NestCampaignMlaApiRepository,
        mercadolibreApiRepository: NestMercadolibreApiRepository,
        priceApiRepository: NestPriceApiRepository,
        saveAllPromotion: SaveAllPromotion,
        configService: AppConfigService,
      ) =>
        new SyncAllPromotions({
          campaignMlaApiRepository,
          mercadolibreApiRepository,
          priceApiRepository,
          saveAllPromotion,
          config: configService.get(),
        }),
      inject: [
        NestCampaignMlaApiRepository,
        NestMercadolibreApiRepository,
        NestPriceApiRepository,
        'SaveAllPromotion',
        AppConfigService,
      ],
    },
    {
      provide: 'SyncOnePromotion',
      useFactory: async (
        mercadolibreApiRepository: NestMercadolibreApiRepository,
        syncAllPromotions: SyncAllPromotions,
      ) =>
        new SyncOnePromotion({
          mercadolibreApiRepository,
          syncAllPromotions,
        }),
      inject: [
        NestMercadolibreApiRepository,
        'SyncAllPromotions',
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
        campaignMlaApiRepository: NestCampaignMlaApiRepository,
        mercadolibreApiRepository: NestMercadolibreApiRepository,
        priceApiRepository: NestPriceApiRepository,
        configService: AppConfigService,
      ) =>
        new DeactivatePromotions({
          promotionRepository,
          campaignMlaApiRepository,
          mercadolibreApiRepository,
          priceApiRepository,
          config: configService.get(),
        }),
      inject: [
        MongoPromotionRepository,
        NestCampaignMlaApiRepository,
        NestMercadolibreApiRepository,
        NestPriceApiRepository,
        AppConfigService,
      ],
    },
  ],
})
export class PromotionModule {}
