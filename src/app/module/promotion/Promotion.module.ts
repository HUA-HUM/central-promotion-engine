import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { AutomeliController } from '@app/controller/automeli/AutomeliController';
import { PromotionsController } from '@app/controller/promotions/PromotionsController';
import { AppConfigService } from '@app/drivers/config/AppConfigService';
import {
  NestAutomeliUpdateRepository,
  NestAutomeliEnableUpdateRepository,
} from '@app/drivers/repositories/automeli/NestAutomeliUpdateRepository';
import { NestCampaignMlaApiRepository } from '@app/drivers/repositories/madre-api/NestCampaignMlaApiRepository';
import { NestMercadolibreApiRepository } from '@app/drivers/repositories/mercadolibre/NestMercadolibreApiRepository';
import { NestPriceApiRepository } from '@app/drivers/repositories/price-api/NestPriceApiRepository';
import { MongoPromotionRepository } from '@app/drivers/repositories/mongo/MongoPromotionRepository';
import { MongoModule } from '@app/module/Mongo.module';
import { PromotionAutomationService } from '@app/service/PromotionAutomation.service';
import { ActivatePromotions } from '@core/interactors/promotion/ActivatePromotions';
import { ActivateDealPromotion } from '@core/interactors/promotion/ActivateDealPromotion';
import { AutomeliMlaControl } from '@core/interactors/promotion/AutomeliMlaControl';
import { DeactivatePromotions } from '@core/interactors/promotion/DeactivatePromotions';
import { DeactivateDealPromotion } from '@core/interactors/promotion/DeactivateDealPromotion';
import { GetPromotionCatalogs } from '@core/interactors/promotion/GetPromotionCatalogs';
import { GetPromotions } from '@core/interactors/promotion/GetPromotions';
import { GetPromotionStats } from '@core/interactors/promotion/GetPromotionStats';
import { SaveAllPromotion } from '@core/interactors/promotion/SaveAllPromotion';
import { DealPriceControlService } from '@core/interactors/promotion/services/DealPriceControlService';
import { SyncAllPromotions } from '@core/interactors/promotion/SyncAllPromotions';
import { SyncOnePromotion } from '@core/interactors/promotion/SyncOnePromotion';

@Module({
  imports: [HttpModule, MongoModule],
  controllers: [PromotionsController, AutomeliController],
  providers: [
    AppConfigService,
    MongoPromotionRepository,
    NestAutomeliUpdateRepository,
    NestAutomeliEnableUpdateRepository,
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
      provide: 'GetPromotionCatalogs',
      useFactory: async (promotionRepository: MongoPromotionRepository) =>
        new GetPromotionCatalogs({
          promotionRepository,
        }),
      inject: [MongoPromotionRepository],
    },
    {
      provide: 'GetPromotionStats',
      useFactory: async (promotionRepository: MongoPromotionRepository) =>
        new GetPromotionStats({
          promotionRepository,
        }),
      inject: [MongoPromotionRepository],
    },
    {
      provide: 'DealPriceControlService',
      useFactory: async (
        automeliUpdateRepository: NestAutomeliUpdateRepository,
        automeliEnableUpdateRepository: NestAutomeliEnableUpdateRepository,
        mercadolibreApiRepository: NestMercadolibreApiRepository,
        priceApiRepository: NestPriceApiRepository,
        configService: AppConfigService,
      ) =>
        new DealPriceControlService({
          automeliUpdateRepository,
          automeliEnableUpdateRepository,
          mercadolibreApiRepository,
          priceApiRepository,
          config: configService.get(),
        }),
      inject: [
        NestAutomeliUpdateRepository,
        NestAutomeliEnableUpdateRepository,
        NestMercadolibreApiRepository,
        NestPriceApiRepository,
        AppConfigService,
      ],
    },
    {
      provide: 'SyncAllPromotions',
      useFactory: async (
        campaignMlaApiRepository: NestCampaignMlaApiRepository,
        mercadolibreApiRepository: NestMercadolibreApiRepository,
        priceApiRepository: NestPriceApiRepository,
        saveAllPromotion: SaveAllPromotion,
        configService: AppConfigService,
        dealPriceControlService: DealPriceControlService,
        promotionRepository: MongoPromotionRepository,
      ) =>
        new SyncAllPromotions({
          campaignMlaApiRepository,
          mercadolibreApiRepository,
          priceApiRepository,
          saveAllPromotion,
          config: configService.get(),
          dealPriceControlService,
          promotionRepository,
        }),
      inject: [
        NestCampaignMlaApiRepository,
        NestMercadolibreApiRepository,
        NestPriceApiRepository,
        'SaveAllPromotion',
        AppConfigService,
        'DealPriceControlService',
        MongoPromotionRepository,
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
        priceApiRepository: NestPriceApiRepository,
        configService: AppConfigService,
      ) =>
        new ActivatePromotions({
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
    {
      provide: 'ActivateDealPromotion',
      useFactory: async (
        promotionRepository: MongoPromotionRepository,
        mercadolibreApiRepository: NestMercadolibreApiRepository,
        priceApiRepository: NestPriceApiRepository,
        automeliMlaControl: AutomeliMlaControl,
        configService: AppConfigService,
      ) =>
        new ActivateDealPromotion({
          promotionRepository,
          mercadolibreApiRepository,
          priceApiRepository,
          automeliMlaControl,
          config: configService.get(),
        }),
      inject: [
        MongoPromotionRepository,
        NestMercadolibreApiRepository,
        NestPriceApiRepository,
        'AutomeliMlaControl',
        AppConfigService,
      ],
    },
    {
      provide: 'DeactivateDealPromotion',
      useFactory: async (
        promotionRepository: MongoPromotionRepository,
        mercadolibreApiRepository: NestMercadolibreApiRepository,
        dealPriceControlService: DealPriceControlService,
      ) =>
        new DeactivateDealPromotion({
          promotionRepository,
          mercadolibreApiRepository,
          dealPriceControlService,
        }),
      inject: [MongoPromotionRepository, NestMercadolibreApiRepository, 'DealPriceControlService'],
    },
    {
      provide: 'AutomeliMlaControl',
      useFactory: async (
        automeliUpdateRepository: NestAutomeliUpdateRepository,
        automeliEnableUpdateRepository: NestAutomeliEnableUpdateRepository,
        configService: AppConfigService,
      ) =>
        new AutomeliMlaControl({
          automeliUpdateRepository,
          automeliEnableUpdateRepository,
          config: configService.get(),
        }),
      inject: [NestAutomeliUpdateRepository, NestAutomeliEnableUpdateRepository, AppConfigService],
    },
    {
      provide: 'DeactivatePromotions',
      useFactory: async (
        promotionRepository: MongoPromotionRepository,
        campaignMlaApiRepository: NestCampaignMlaApiRepository,
        mercadolibreApiRepository: NestMercadolibreApiRepository,
        priceApiRepository: NestPriceApiRepository,
        dealPriceControlService: DealPriceControlService,
        configService: AppConfigService,
      ) =>
        new DeactivatePromotions({
          promotionRepository,
          campaignMlaApiRepository,
          mercadolibreApiRepository,
          priceApiRepository,
          dealPriceControlService,
          config: configService.get(),
        }),
      inject: [
        MongoPromotionRepository,
        NestCampaignMlaApiRepository,
        NestMercadolibreApiRepository,
        NestPriceApiRepository,
        'DealPriceControlService',
        AppConfigService,
      ],
    },
  ],
})
export class PromotionModule {}
