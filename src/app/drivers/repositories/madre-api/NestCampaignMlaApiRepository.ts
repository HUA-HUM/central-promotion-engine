import { HttpService } from '@nestjs/axios';
import { Injectable } from '@nestjs/common';
import { AppConfigService } from '@app/drivers/config/AppConfigService';
import { APICampaignMlaApiRepository } from '@core/drivers/repositories/madre-api/APICampaignMlaApiRepository';

@Injectable()
export class NestCampaignMlaApiRepository extends APICampaignMlaApiRepository {
  constructor(httpService: HttpService, configService: AppConfigService) {
    const config = configService.get();

    super({
      axios: httpService.axiosRef,
      baseUrl: config.campaignMlaApiBaseUrl,
      timeout: config.campaignMlaApiTimeout,
      apiToken: config.campaignMlaApiToken,
    });
  }
}
