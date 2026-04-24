import { HttpService } from '@nestjs/axios';
import { Injectable } from '@nestjs/common';
import { AppConfigService } from '@app/drivers/config/AppConfigService';
import { APIPriceApiRepository } from '@core/drivers/repositories/price-api/APIPriceApiRepository';

@Injectable()
export class NestPriceApiRepository extends APIPriceApiRepository {
  constructor(httpService: HttpService, configService: AppConfigService) {
    const config = configService.get();

    super({
      axios: httpService.axiosRef,
      baseUrl: config.priceApiBaseUrl,
      timeout: config.priceApiTimeout,
      apiToken: config.priceApiToken,
    });
  }
}
