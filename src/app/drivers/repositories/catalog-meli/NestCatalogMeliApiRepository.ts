import { HttpService } from '@nestjs/axios';
import { Injectable } from '@nestjs/common';
import { AppConfigService } from '@app/drivers/config/AppConfigService';
import { APICatalogMeliApiRepository } from '@core/drivers/repositories/catalog-meli/APICatalogMeliApiRepository';

@Injectable()
export class NestCatalogMeliApiRepository extends APICatalogMeliApiRepository {
  constructor(httpService: HttpService, configService: AppConfigService) {
    const config = configService.get();

    super({
      axios: httpService.axiosRef,
      baseUrl: config.catalogMeliApiBaseUrl,
      timeout: config.catalogMeliApiTimeout,
      apiToken: config.catalogMeliApiToken,
      metricsLoggingEnabled: config.metricsLoggingEnabled,
    });
  }
}
