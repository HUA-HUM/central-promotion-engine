import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppConfig } from '@app/drivers/config/AppConfig';

@Injectable()
export class AppConfigService {
  constructor(private readonly configService: ConfigService) {}

  get(): AppConfig {
    return {
      port: this.number('PORT', 3000),
      serviceName: this.configService.get<string>('SERVICE_NAME', 'central-promos-enginee'),
      mongoUrl: this.configService.getOrThrow<string>('MONGO_URL'),
      campaignMlaApiBaseUrl: this.configService.getOrThrow<string>('CAMPAIGN_MLA_API_BASE_URL'),
      campaignMlaApiTimeout: this.number('CAMPAIGN_MLA_API_TIMEOUT', 10000),
      campaignMlaApiToken: this.configService.get<string>('CAMPAIGN_MLA_API_TOKEN'),
      syncPromotionTypes: this.configService.get<string>('SYNC_PROMOTION_TYPES', 'PRE_NEGOTIATED,DEAL,SMART').split(','),
      mercadolibreApiBaseUrl: this.configService.getOrThrow<string>('MERCADOLIBRE_API_BASE_URL'),
      mercadolibreApiTimeout: this.number('MERCADOLIBRE_API_TIMEOUT', 10000),
      mercadolibreApiToken: this.configService.get<string>('MERCADOLIBRE_API_TOKEN'),
      mercadolibreAppKey: this.configService.get<string>('MERCADOLIBRE_APP_KEY', 'promotions-engine-api'),
      priceApiBaseUrl: this.configService.getOrThrow<string>('PRICE_API_BASE_URL'),
      priceApiTimeout: this.number('PRICE_API_TIMEOUT', 10000),
      priceApiToken:this.configService.get<string>('PRICE_API_TOKEN'),
      catalogMeliApiBaseUrl: this.configService.getOrThrow<string>('CATALOG_MELI_API_BASE_URL'),
      catalogMeliApiTimeout: this.number('CATALOG_MELI_API_TIMEOUT', 10000),
      catalogMeliApiToken: this.configService.get<string>('CATALOG_MELI_API_TOKEN'),
      catalogMeliApiEnabled:
        this.configService.get<string>('CATALOG_MELI_API_ENABLED', 'true') === 'true',
      syncCron: this.configService.get<string>('SYNC_PROMOTIONS_CRON', '0 0 */12 * * *'),
      activateCron: this.configService.get<string>('ACTIVATE_PROMOTIONS_CRON', '0 0 */8 * * *'),
      deactivateCron: this.configService.get<string>('DEACTIVATE_PROMOTIONS_CRON', '0 0 */10 * * *'),
      enabledCronProcesses: AppConfigService.parseEnabledCronProcesses(
        this.configService.get<string>('ENABLED_CRON_PROCESSES', ''),
      ),
      defaultMinProfitability: this.number('DEFAULT_MIN_PROFITABILITY', 0),
      defaultMinProfit: this.number('DEFAULT_MIN_PROFIT', 0),
      syncPromotion: this.configService.get<string>('SYNC_PROMOTION', ''),
      syncPromotionConcurrency: this.number('SYNC_PROMOTION_CONCURRENCY', 3),
      automeliApiBaseUrl: this.configService.get<string>('AUTOMELI_API_BASE_URL', ''),
      automeliApiTimeout: this.number('AUTOMELI_API_TIMEOUT', 10000),
      automeliApiToken: this.configService.get<string>('AUTOMELI_API_TOKEN'),
      automeliSellerId: this.number('AUTOMELI_SELLER_ID', 0),
      dealPriceControlEnabled: this.configService.get<string>('DEAL_PRICE_CONTROL_ENABLED', 'false') === 'true',
      dealPriceControlMaxBaseIncreasePercentage: this.number(
        'DEAL_PRICE_CONTROL_MAX_BASE_INCREASE_PERCENTAGE',
        0.3,
      ),
      metricsLoggingEnabled: this.configService.get<string>('METRICS_LOGGING_ENABLED', 'false') === 'true',
    };
  }

  // ConfigService.get returns raw env strings (no coercion despite the <number> generic),
  // so numeric config must be parsed explicitly — e.g. `1 + "0.3"` would concatenate to "10.3".
  private number(key: string, fallback: number): number {
    const rawValue = this.configService.get<string | number>(key);

    if (rawValue === undefined || rawValue === null || rawValue === '') {
      return fallback;
    }

    const parsed = Number(rawValue);

    return Number.isFinite(parsed) ? parsed : fallback;
  }

  private static readonly ALL_CRON_PROCESSES = ['sync', 'activate', 'deactivate'];

  private static parseEnabledCronProcesses(rawValue: string): string[] {
    const processes = rawValue
      .split(',')
      .map((process) => process.trim())
      .filter(Boolean);

    return processes.length > 0 ? processes : AppConfigService.ALL_CRON_PROCESSES;
  }
}
