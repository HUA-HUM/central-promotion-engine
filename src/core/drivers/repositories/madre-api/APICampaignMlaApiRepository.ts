import {
  CampaignMlaExistsBulkResponse,
  CampaignMlaSaveBulkResponse,
  IAPICampaignMlaApiRepository,
} from '@core/adapters/repositories/madre-api/IAPICampaignMlaApiRepository';
import { APIHttpClient } from '@core/drivers/repositories/http/APIHttpClient';
import { AxiosInstance } from 'axios';

export interface APICampaignMlaApiRepositoryConfig {
  axios: AxiosInstance;
  baseUrl: string;
  timeout: number;
  apiToken?: string;
}

export class APICampaignMlaApiRepository
  extends APIHttpClient
  implements IAPICampaignMlaApiRepository
{
  constructor(private readonly repositoryConfig: APICampaignMlaApiRepositoryConfig) {
    super({
      axios: repositoryConfig.axios,
      baseUrl: repositoryConfig.baseUrl,
      timeout: repositoryConfig.timeout,
      service: 'campaign-mla-api',
    });
  }

  async existsBulk(mlas: string[]): Promise<CampaignMlaExistsBulkResponse> {
    return this.post('/api/internal/central-promos/campaign-mlas/exists/bulk', { mlas }, {
      headers: this.headers(),
    });
  }

  async saveBulk(mlas: string[]): Promise<CampaignMlaSaveBulkResponse> {
    return this.post('/api/internal/central-promos/campaign-mlas/bulk', { mlas }, {
      headers: this.headers(),
    });
  }

  private headers(): Record<string, string> {
    return this.repositoryConfig.apiToken
      ? { 'x-internal-api-key': this.repositoryConfig.apiToken }
      : {};
  }
}
