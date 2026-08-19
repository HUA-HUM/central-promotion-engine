import { AxiosInstance } from 'axios';
import { APIHttpClient } from '@core/drivers/repositories/http/APIHttpClient';
import {
  AutomeliAppStatus,
  AutomeliAppStatusCommand,
  AutomeliAppStatusResponse,
} from '@core/adapters/repositories/automeli/AutomeliAppStatusRepository';

export interface APIAutomeliAppStatusRepositoryConfig {
  axios: AxiosInstance;
  baseUrl: string;
  timeout: number;
  apiToken?: string;
}

interface AutomeliAppStatusRawResponse {
  status: AutomeliAppStatus;
  requested: number;
  updated: number;
  matched?: number;
  not_found?: string[];
}

export abstract class APIAutomeliAppStatusRepository extends APIHttpClient {
  private static readonly PATH = '/api/productos/app-status';
  private static readonly BATCH_SIZE = 1000;

  constructor(private readonly repositoryConfig: APIAutomeliAppStatusRepositoryConfig) {
    super({
      axios: repositoryConfig.axios,
      baseUrl: repositoryConfig.baseUrl,
      timeout: repositoryConfig.timeout,
      service: 'automeli-api',
    });
  }

  protected async updateStatus(
    command: AutomeliAppStatusCommand,
    status: AutomeliAppStatus,
  ): Promise<AutomeliAppStatusResponse> {
    const listingIds = Array.from(new Set(command.listingIds));
    const batches = this.chunk(listingIds, APIAutomeliAppStatusRepository.BATCH_SIZE);

    const responses: AutomeliAppStatusRawResponse[] = [];
    for (const batch of batches) {
      const response = await this.patch<AutomeliAppStatusRawResponse>(
        APIAutomeliAppStatusRepository.PATH,
        {
          seller_id: command.sellerId,
          listing_ids: batch,
          status,
          include_not_found: command.includeNotFound,
        },
        { headers: this.headers() },
      );
      responses.push(response);
    }

    return this.mergeResponses(status, responses);
  }

  private mergeResponses(
    status: AutomeliAppStatus,
    responses: AutomeliAppStatusRawResponse[],
  ): AutomeliAppStatusResponse {
    return responses.reduce<AutomeliAppStatusResponse>(
      (merged, response) => ({
        status: response.status ?? merged.status,
        requested: merged.requested + (response.requested ?? 0),
        updated: merged.updated + (response.updated ?? 0),
        matched: (merged.matched ?? 0) + (response.matched ?? 0),
        notFound: [...(merged.notFound ?? []), ...(response.not_found ?? [])],
      }),
      { status, requested: 0, updated: 0, matched: 0, notFound: [] },
    );
  }

  private chunk<T>(items: T[], size: number): T[][] {
    const chunks: T[][] = [];

    for (let index = 0; index < items.length; index += size) {
      chunks.push(items.slice(index, index + size));
    }

    return chunks;
  }

  private headers(): Record<string, string> {
    return this.repositoryConfig.apiToken
      ? { 'x-internal-api-key': this.repositoryConfig.apiToken }
      : {};
  }
}
