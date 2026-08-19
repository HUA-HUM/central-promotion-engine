import { HttpService } from '@nestjs/axios';
import { Injectable } from '@nestjs/common';
import { AppConfigService } from '@app/drivers/config/AppConfigService';
import {
  APIAutomeliUpdateRepository,
  APIAutomeliEnableUpdateRepository,
} from '@core/drivers/repositories/automeli/APIAutomeliUpdateRepository';

@Injectable()
export class NestAutomeliUpdateRepository extends APIAutomeliUpdateRepository {
  constructor(httpService: HttpService, configService: AppConfigService) {
    const config = configService.get();

    super({
      axios: httpService.axiosRef,
      baseUrl: config.automeliApiBaseUrl,
      timeout: config.automeliApiTimeout,
      apiToken: config.automeliApiToken,
    });
  }
}

@Injectable()
export class NestAutomeliEnableUpdateRepository extends APIAutomeliEnableUpdateRepository {
  constructor(httpService: HttpService, configService: AppConfigService) {
    const config = configService.get();

    super({
      axios: httpService.axiosRef,
      baseUrl: config.automeliApiBaseUrl,
      timeout: config.automeliApiTimeout,
      apiToken: config.automeliApiToken,
    });
  }
}
