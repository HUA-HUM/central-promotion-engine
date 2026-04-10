import { HttpService } from '@nestjs/axios';
import { Injectable } from '@nestjs/common';
import { AppConfigService } from '@app/drivers/config/AppConfigService';
import {
  CampaignMlaApiRepository,
  CampaignMlaExistsBulkResponse,
  CampaignMlaSaveBulkResponse,
} from '@core/adapters/repositories/ICampaignMlaApiRepository';
import { loggerError, loggerInfo } from '@core/drivers/logger/Logger';
import { firstValueFrom } from 'rxjs';

@Injectable()
export class NestCampaignMlaApiRepository implements CampaignMlaApiRepository {
  constructor(
    private readonly httpService: HttpService,
    private readonly configService: AppConfigService,
  ) {}

  async existsBulk(mlas: string[]): Promise<CampaignMlaExistsBulkResponse> {
    return this.post('/api/internal/central-promos/campaign-mlas/exists/bulk', { mlas });
  }

  async saveBulk(mlas: string[]): Promise<CampaignMlaSaveBulkResponse> {
    return this.post('/api/internal/central-promos/campaign-mlas/bulk', { mlas });
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    const config = this.configService.get();
    const url = `${config.campaignMlaApiBaseUrl}${path}`;
    try {
      const response = await firstValueFrom(
        this.httpService.post<T>(url, body, {
          timeout: config.campaignMlaApiTimeout,
          headers: this.headers(config.campaignMlaApiToken),
        }),
      );
      loggerInfo({
        config: {
          method: 'POST',
          url,
          headers: this.headers(config.campaignMlaApiToken),
          data: body,
          message: 'campaign-mla-api request completed',
          services: 'campaign-mla-api',
          status: response.status,
          response: response.data,
        },
      });
      return response.data;
    } catch (error) {
      loggerError(error, body, url, 'campaign-mla-api');
      throw error;
    }
  }

  private headers(token?: string): Record<string, string> {
    return token ? { 'x-internal-api-key': `${token}` } : {};
  }
}