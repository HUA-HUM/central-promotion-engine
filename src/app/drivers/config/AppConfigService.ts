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
      mercadolibreApiBaseUrl: this.configService.getOrThrow<string>('MERCADOLIBRE_API_BASE_URL'),
      mercadolibreApiTimeout: this.configService.get<number>('MERCADOLIBRE_API_TIMEOUT', 10000),
      mercadolibreApiToken: this.configService.get<string>('MERCADOLIBRE_API_TOKEN'),
      priceApiBaseUrl: this.configService.getOrThrow<string>('PRICE_API_BASE_URL'),
      priceApiTimeout: this.configService.get<number>('PRICE_API_TIMEOUT', 10000),
      priceApiToken: this.configService.get<string>('PRICE_API_TOKEN'),
      syncCron: this.configService.get<string>('SYNC_PROMOTIONS_CRON', '0 */30 * * * *'),
      activateCron: this.configService.get<string>('ACTIVATE_PROMOTIONS_CRON', '0 */15 * * * *'),
      deactivateCron: this.configService.get<string>('DEACTIVATE_PROMOTIONS_CRON', '0 */20 * * * *'),
      defaultMinProfitability: this.configService.get<number>('DEFAULT_MIN_PROFITABILITY', 0.12),
      defaultMinProfit: this.configService.get<number>('DEFAULT_MIN_PROFIT', 0),
    };
  }
}
