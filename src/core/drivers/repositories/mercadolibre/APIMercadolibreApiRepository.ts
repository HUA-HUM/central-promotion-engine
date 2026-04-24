import {
  ActivatePromotionCommand,
  EligibleItem,
  ItemDetail,
  MeliEligibleItem,
  MeliItemDetail,
  MeliPaginatedResponse,
  MeliPromotionCatalog,
  IAPIMercadolibreApiRepository,
  PauseOrDeletePromotionCommand,
  PromotionCatalog,
} from '@core/adapters/repositories/mercadolibre/IAPIMercadolibreApiRepository';
import { PromotionType } from '@core/entities/PromotionCatalog';
import { Logger } from '@core/drivers/logger/Logger';
import { APIHttpClient } from '@core/drivers/repositories/http/APIHttpClient';
import { AxiosInstance } from 'axios';

export interface APIMercadolibreApiRepositoryConfig {
  axios: AxiosInstance;
  baseUrl: string;
  timeout: number;
  apiToken?: string;
  syncPromotionTypes: string[];
}

export class APIMercadolibreApiRepository
  extends APIHttpClient
  implements IAPIMercadolibreApiRepository
{
  constructor(private readonly repositoryConfig: APIMercadolibreApiRepositoryConfig) {
    super({
      axios: repositoryConfig.axios,
      baseUrl: repositoryConfig.baseUrl,
      timeout: repositoryConfig.timeout,
      service: 'mercadolibre-api',
    });
  }

  async getPromotions(): Promise<PromotionCatalog[]> {
    const params = new URLSearchParams({
      limit: '50',
      offset: '0',
    });
    const response = await this.get<MeliPaginatedResponse<MeliPromotionCatalog>>(
      `/meli/seller-promotions?${params.toString()}`,
      { headers: this.headers() },
    );
    const rawPromotionResults = this.normalizeResults(response.results);
    const filteredResults = rawPromotionResults.filter((promotion) =>
      this.repositoryConfig.syncPromotionTypes.includes(promotion.type),
    );

    if (filteredResults.length === 0) {
      return [];
    }

    const promotionResults = await Promise.all(
      filteredResults.map(async (promotion) => {
        const itemsPaginated = await this.getElegibleItemsPaginated(promotion.id, promotion.type);

        return {
          promotionId: promotion.id,
          type: promotion.type,
          status: promotion.status,
          startDate: this.parseDate(promotion.start_date),
          finishDate: this.parseDate(promotion.finish_date),
          deadlineDate: this.parseDate(promotion.deadline_date),
          name: promotion.name,
          subType: promotion.sub_type,
          fixedAmount: promotion.fixed_amount,
          minPurchaseAmount: promotion.min_purchase_amount,
          totalCandidates: itemsPaginated.paging.total,
        };
      }),
    );

    return promotionResults;
  }

  async getEligibleItems(promotionId: string, promotionType: string): Promise<EligibleItem[]> {
    try {
      const response = await this.get<MeliPaginatedResponse<EligibleItem>>(
        `/meli/seller-promotions/${promotionId}/items?promotion_type=${promotionType}`,
        { headers: this.headers() },
      );
      return this.normalizeResults(response.results);
    } catch {
      return [];
    }
  }

  async getElegibleItemsPaginated(
    promotionId: string,
    promotionType: string,
    searchAfter?: string,
  ): Promise<MeliPaginatedResponse<EligibleItem>> {
    try {
      const params = new URLSearchParams({
        promotion_type: promotionType,
        limit: '50',
      });

      if (searchAfter) {
        params.append('searchAfter', searchAfter);
      }

      const response = await this.get<MeliPaginatedResponse<MeliEligibleItem>>(
        `/meli/seller-promotions/${promotionId}/items?${params.toString()}`,
        { headers: this.headers() },
      );
      const results = this.normalizeResults(response.results);

      return {
        paging: response.paging,
        results: results.map((item) => ({
          itemId: item.id,
          status: item.status,
          offerId: item.offer_id,
          originalPrice: item.original_price,
          minPrice: item.min_discounted_price,
          maxPrice: item.max_discounted_price,
          suggestedPrice: item.suggested_discounted_price ?? item.price,
          sellerPercentage: item.seller_percentage,
          meliPercentage: item.meli_percentage,
        })),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown mercadolibre error';
      Logger.warn(
        JSON.stringify({
          message: `Promotion ${promotionId} of type ${promotionType} has no eligible items or failed to fetch them`,
          service: 'mercadolibre-api',
          promotionId,
          promotionType,
          searchAfter: searchAfter ?? null,
          reason: message,
        }),
      );

      return {
        paging: {
          total: 0,
          limit: 50,
        },
        results: [],
      };
    }
  }

  async getItemDetail(itemId: string): Promise<ItemDetail> {
    const detail = await this.get<MeliItemDetail>(`/meli/products/${itemId}`, {
      headers: this.headers(),
    });

    return {
      itemId: detail.id,
      sku: detail.sellerSku,
      categoryId: detail.categoryId,
      listingTypeId: detail.listingTypeId,
      price: detail.price,
    };
  }

  async activatePromotion(
    command: ActivatePromotionCommand,
  ): Promise<{ offerId?: string; status: string }> {
    const requestBody: {
      promotion_id: string;
      promotion_type: string;
      offer_id?: string;
      deal_price?: number;
    } = {
      promotion_id: command.promotionId,
      promotion_type: command.promotionType,
    };

    if ('dealPrice' in command) {
      requestBody.deal_price = command.dealPrice;
    } else {
      requestBody.offer_id = command.offerId;
    }

    const response = await this.post<{ offer_id?: string; status: string }>(
      `/meli/seller-promotions/items/${command.itemId}`,
      requestBody,
      { headers: this.headers() },
    );

    return {
      offerId: response.offer_id,
      status: response.status,
    };
  }

  async pauseOrDeletePromotion(
    command: PauseOrDeletePromotionCommand,
  ): Promise<{ status: string }> {
    const params: Record<string, string> = {
      promotion_id: command.promotionId,
      promotion_type: command.promotionType,
      action: command.action,
    };

    if (command.offerId) {
      params.offer_id = command.offerId;
    }

    return this.delete<{ status: string }>(`/meli/seller-promotions/items/${command.itemId}`, {
      headers: this.headers(),
      params,
    });
  }

  private headers(): Record<string, string> {
    return this.repositoryConfig.apiToken
      ? { 'x-internal-api-key': this.repositoryConfig.apiToken }
      : {};
  }

  private parseDate(rawDate?: string): Date | undefined {
    if (!rawDate) {
      return undefined;
    }

    const parsedDate = new Date(rawDate);
    return Number.isNaN(parsedDate.getTime()) ? undefined : parsedDate;
  }

  private normalizeResults<T>(results: T[] | null | undefined): T[] {
    return Array.isArray(results) ? results : [];
  }
}
