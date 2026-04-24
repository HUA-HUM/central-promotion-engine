import { HttpService } from '@nestjs/axios';
import { Injectable } from '@nestjs/common';
import { AppConfigService } from '@app/drivers/config/AppConfigService';
import { APIMercadolibreApiRepository } from '@core/drivers/repositories/mercadolibre/APIMercadolibreApiRepository';

@Injectable()
export class NestMercadolibreApiRepository extends APIMercadolibreApiRepository {
  constructor(httpService: HttpService, configService: AppConfigService) {
    const config = configService.get();

    super({
      axios: httpService.axiosRef,
      baseUrl: config.mercadolibreApiBaseUrl,
      timeout: config.mercadolibreApiTimeout,
      apiToken: config.mercadolibreApiToken,
      syncPromotionTypes: config.syncPromotionTypes,
    });
  }
}
