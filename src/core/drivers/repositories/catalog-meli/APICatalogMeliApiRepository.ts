import {
  CatalogMeliLookupResult,
  IAPICatalogMeliApiRepository,
} from '@core/adapters/repositories/catalog-meli/IAPICatalogMeliApiRepository';
import { ItemDetail } from '@core/adapters/repositories/mercadolibre/IAPIMercadolibreApiRepository';
import { APIHttpClient } from '@core/drivers/repositories/http/APIHttpClient';
import { AxiosInstance } from 'axios';

export interface APICatalogMeliApiRepositoryConfig {
  axios: AxiosInstance;
  baseUrl: string;
  timeout: number;
  apiToken?: string;
  metricsLoggingEnabled: boolean;
}

interface CatalogMeliProductRaw {
  itemId: string;
  sku: string;
  categoryId: string;
  listingTypeId: string;
  price: number;
}

interface CatalogMeliLookupRawResponse {
  requested: number;
  found: number;
  not_found?: string[];
  products?: CatalogMeliProductRaw[];
}

export class APICatalogMeliApiRepository
  extends APIHttpClient
  implements IAPICatalogMeliApiRepository
{
  private static readonly LOOKUP_CHUNK_SIZE = 50;

  constructor(private readonly repositoryConfig: APICatalogMeliApiRepositoryConfig) {
    super({
      axios: repositoryConfig.axios,
      baseUrl: repositoryConfig.baseUrl,
      timeout: repositoryConfig.timeout,
      service: 'catalog-meli-api',
      metricsLoggingEnabled: repositoryConfig.metricsLoggingEnabled,
    });
  }

  async lookupItemDetails(itemIds: string[]): Promise<CatalogMeliLookupResult> {
    if (itemIds.length === 0) {
      return { products: [], notFound: [] };
    }

    const chunks = this.chunkArray(itemIds, APICatalogMeliApiRepository.LOOKUP_CHUNK_SIZE);
    const chunkResults = await Promise.all(chunks.map((chunk) => this.lookupChunk(chunk)));

    return chunkResults.reduce<CatalogMeliLookupResult>(
      (acc, result) => ({
        products: acc.products.concat(result.products),
        notFound: acc.notFound.concat(result.notFound),
      }),
      { products: [], notFound: [] },
    );
  }

  private async lookupChunk(itemIds: string[]): Promise<CatalogMeliLookupResult> {
    const params = new URLSearchParams({ ids: itemIds.join(',') });

    const response = await this.get<CatalogMeliLookupRawResponse>(
      `/analytics/products/lookup?${params.toString()}`,
      { headers: this.headers() },
    );

    const products: ItemDetail[] = this.normalizeResults(response.products).map((product) => ({
      itemId: product.itemId,
      sku: product.sku,
      categoryId: product.categoryId,
      listingTypeId: product.listingTypeId,
      price: product.price,
    }));

    const returnedItemIds = new Set(products.map((product) => product.itemId));
    const notFound = Array.from(
      new Set([
        ...this.normalizeResults(response.not_found),
        ...itemIds.filter((itemId) => !returnedItemIds.has(itemId)),
      ]),
    );

    return { products, notFound };
  }

  private chunkArray<T>(items: T[], size: number): T[][] {
    const chunks: T[][] = [];

    for (let index = 0; index < items.length; index += size) {
      chunks.push(items.slice(index, index + size));
    }

    return chunks;
  }

  private normalizeResults<T>(results: T[] | null | undefined): T[] {
    return Array.isArray(results) ? results : [];
  }

  private headers(): Record<string, string> {
    return this.repositoryConfig.apiToken
      ? { 'x-internal-api-key': this.repositoryConfig.apiToken }
      : {};
  }
}
