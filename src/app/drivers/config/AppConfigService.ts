import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppConfig } from '@app/drivers/config/AppConfig';

@Injectable()
export class AppConfigService {
  constructor(private readonly configService: ConfigService) {}

  get(): AppConfig {
    return {
      port: this.configService.get<number>('PORT', 3000),
      serviceName: this.configService.get<string>('SERVICE_NAME', 'central-promos-enginee'),
      mongoUrl: this.configService.getOrThrow<string>('MONGO_URL'),
      campaignMlaApiBaseUrl: this.configService.getOrThrow<string>('CAMPAIGN_MLA_API_BASE_URL'),
      campaignMlaApiTimeout: this.configService.get<number>('CAMPAIGN_MLA_API_TIMEOUT', 10000),
      campaignMlaApiToken: this.configService.get<string>('CAMPAIGN_MLA_API_TOKEN'),
      syncPromotionTypes: this.configService.get<string>('SYNC_PROMOTION_TYPES', 'PRE_NEGOTIATED,DEAL,SMART').split(','),
      mercadolibreApiBaseUrl: this.configService.getOrThrow<string>('MERCADOLIBRE_API_BASE_URL'),
      mercadolibreApiTimeout: this.configService.get<number>('MERCADOLIBRE_API_TIMEOUT', 10000),
      mercadolibreApiToken: this.configService.get<string>('MERCADOLIBRE_API_TOKEN'),
      mercadolibreAppKey: this.configService.get<string>('MERCADOLIBRE_APP_KEY', 'promotions-engine-api'),
      priceApiBaseUrl: this.configService.getOrThrow<string>('PRICE_API_BASE_URL'),
      priceApiTimeout: this.configService.get<number>('PRICE_API_TIMEOUT', 10000),
      priceApiToken:this.configService.get<string>('PRICE_API_TOKEN'),
      syncCron: this.configService.get<string>('SYNC_PROMOTIONS_CRON', '0 0 */12 * * *'),
      activateCron: this.configService.get<string>('ACTIVATE_PROMOTIONS_CRON', '0 0 */8 * * *'),
      deactivateCron: this.configService.get<string>('DEACTIVATE_PROMOTIONS_CRON', '0 0 */10 * * *'),
      defaultMinProfitability: this.configService.get<number>('DEFAULT_MIN_PROFITABILITY', 12),
      defaultMinProfit: this.configService.get<number>('DEFAULT_MIN_PROFIT', 0),
      syncPromotion: this.configService.get<string>('SYNC_PROMOTION', ''),
      automeliApiBaseUrl: this.configService.get<string>('AUTOMELI_API_BASE_URL', ''),
      automeliApiTimeout: this.configService.get<number>('AUTOMELI_API_TIMEOUT', 10000),
      automeliApiToken: this.configService.get<string>('AUTOMELI_API_TOKEN'),
      automeliSellerId: this.configService.get<number>('AUTOMELI_SELLER_ID', 0),
      dealPriceControlEnabled: this.configService.get<string>('DEAL_PRICE_CONTROL_ENABLED', 'false') === 'true',
      dealPriceControlMaxBaseIncreasePercentage: this.configService.get<number>(
        'DEAL_PRICE_CONTROL_MAX_BASE_INCREASE_PERCENTAGE',
        0.3,
      ),
      metricsLoggingEnabled: this.configService.get<string>('METRICS_LOGGING_ENABLED', 'false') === 'true',
    };
  }
}
