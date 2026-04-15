import { HttpService } from '@nestjs/axios';
import { Injectable } from '@nestjs/common';
import { firstValueFrom } from 'rxjs';
import {
  ActivatePromotionCommand,
  EligibleItem,
  ItemDetail,
  MercadolibreApiRepository,
  PauseOrDeletePromotionCommand,
  PromotionCatalog,
  MeliPaginatedResponse,
  MeliPromotionCatalog,
  MeliEligibleItem,
  MeliItemDetail,
} from '@core/adapters/repositories/IMercadolibreApiRepository';
import { AppConfigService } from '@app/drivers/config/AppConfigService';
import { loggerError, loggerInfo } from '@core/drivers/logger/Logger';
import { PaginationParams, PaginatedResult } from '@core/entities/common/Pagination';

@Injectable()
export class NestMercadolibreApiRepository implements MercadolibreApiRepository {
  constructor(
    private readonly httpService: HttpService,
    private readonly configService: AppConfigService,
  ) {}

  async getPromotions(): Promise<PromotionCatalog[]> {
    const promotionCatalogs: PromotionCatalog[] = [];
    const pagination: PaginationParams = { limit: 50, offset: 0 };
    const res = await this.get<MeliPaginatedResponse<MeliPromotionCatalog>>('/meli/seller-promotions?' + new URLSearchParams({
      limit: pagination.limit.toString(),
      offset: pagination.offset.toString(),
    }));
    // TODO: Implementar lógica de paginación utilizando res.paging
    const promotionPromises = res.results.map(async (promotion) => {
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
    });
    const promotionResults = await Promise.all(promotionPromises);
    promotionCatalogs.push(...promotionResults);
    return promotionCatalogs;
  }

  async getEligibleItems(promotionId: string, promotionType: string): Promise<EligibleItem[]> {
    try {
      const response = await this.get<MeliPaginatedResponse<EligibleItem>>(`/meli/seller-promotions/${promotionId}/items?promotion_type=${promotionType}`);
      return response.results;
    } catch (error) {
      console.log('catch error in getEligibleItems for promotionId', promotionId);
      return [];
    }
  }

  async getElegibleItemsPaginated(promotionId: string, promotionType: string, searchAfter?: string): Promise<MeliPaginatedResponse<EligibleItem>> {
    try {
      const params = new URLSearchParams({
        promotion_type: promotionType,
        limit: '50',
      });
      if (searchAfter) {
        params.append('searchAfter', searchAfter);
      }
      const response = await this.get<MeliPaginatedResponse<MeliEligibleItem>>(`/meli/seller-promotions/${promotionId}/items?${params.toString()}`);
      const eligibleItems: EligibleItem[] = response.results.map((item) => ({
        itemId: item.id,
        status : item.status,
        offerId: item.offer_id,
        originalPrice: item.original_price,
        minPrice: item.min_discounted_price,
        maxPrice: item.max_discounted_price,
        suggestedPrice: item.suggested_discounted_price ?? item.price,
        sellerPercentage: item.seller_percentage,
        meliPercentage: item.meli_percentage,
      }));
      return {
        paging: response.paging,
        results: eligibleItems,
      };
    } catch (error) {
      console.log('catch error in getElegibleItemsPaginated for promotionId', promotionId, promotionType, searchAfter);
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
    const detail = await this.get<MeliItemDetail>(`/meli/products/${itemId}`);
    return {
      itemId: detail.id,
      sku: detail.sellerSku,
      categoryId: detail.categoryId,
      listingTypeId: detail.listingTypeId,
      price: detail.price,
    };
  }

  async activatePromotion(command: ActivatePromotionCommand): Promise<{ offerId?: string; status: string }> {
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
    );

    return {
      offerId: response.offer_id,
      status: response.status,
    };
  }

  async pauseOrDeletePromotion(command: PauseOrDeletePromotionCommand): Promise<{ status: string }> {
    const params: Record<string, string> = {
      promotion_id: command.promotionId,
      promotion_type: command.promotionType,
      action: command.action,
    };

    if (command.offerId) {
      params.offer_id = command.offerId;
    }

    return this.delete<{ status: string }>(`/meli/seller-promotions/items/${command.itemId}`, {
      params,
    });
  }

  private parseDate(rawDate?: string): Date | undefined {
    if (!rawDate) {
      return undefined;
    }

    const parsedDate = new Date(rawDate);
    return Number.isNaN(parsedDate.getTime()) ? undefined : parsedDate;
  }

  private async get<T>(path: string): Promise<T> {
    const config = this.configService.get();
    const url = `${config.mercadolibreApiBaseUrl}${path}`;
    try {
      const response = await firstValueFrom(
        this.httpService.get<T>(url, {
          timeout: config.mercadolibreApiTimeout,
          headers: this.headers(config.mercadolibreApiToken),
        }),
      );
      // loggerInfo({
      //   config: {
      //     method: 'GET',
      //     url,
      //     headers: this.headers(config.mercadolibreApiToken),
      //     message: 'mercadolibre-api request completed',
      //     services: 'mercadolibre-api',
      //     status: response.status,
      //     response: response.data,
      //   },
      // });
      return response.data;
    } catch (error) {
      loggerError(error, null, url, 'mercadolibre-api');
      throw error;
    }
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    const config = this.configService.get();
    const url = `${config.mercadolibreApiBaseUrl}${path}`;
    try {
      const response = await firstValueFrom(
        this.httpService.post<T>(url, body, {
          timeout: config.mercadolibreApiTimeout,
          headers: this.headers(config.mercadolibreApiToken),
        }),
      );
      loggerInfo({
        config: {
          method: 'POST',
          url,
          headers: this.headers(config.mercadolibreApiToken),
          data: body,
          message: 'mercadolibre-api request completed',
          services: 'mercadolibre-api',
          status: response.status,
          response: response.data,
        },
      });
      return response.data;
    } catch (error) {
      loggerError(error, body, url, 'mercadolibre-api');
      throw error;
    }
  }

  private async delete<T>(
    path: string,
    options?: {
      params?: Record<string, string>;
    },
  ): Promise<T> {
    const config = this.configService.get();
    const url = `${config.mercadolibreApiBaseUrl}${path}`;
    try {
      const response = await firstValueFrom(
        this.httpService.delete<T>(url, {
          timeout: config.mercadolibreApiTimeout,
          headers: this.headers(config.mercadolibreApiToken),
          params: options?.params,
        }),
      );
      loggerInfo({
        config: {
          method: 'DELETE',
          url,
          headers: this.headers(config.mercadolibreApiToken),
          message: 'mercadolibre-api request completed',
          services: 'mercadolibre-api',
          status: response.status,
          response: response.data,
        },
      });
      return response.data;
    } catch (error) {
      loggerError(error, null, url, 'mercadolibre-api');
      throw error;
    }
  }

  private headers(token?: string): Record<string, string> {
    return token ? { 'x-internal-api-key': `${token}` } : {};
  }
}
