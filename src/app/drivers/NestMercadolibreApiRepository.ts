import { HttpService } from '@nestjs/axios';
import { Injectable } from '@nestjs/common';
import { firstValueFrom } from 'rxjs';
import {
  EligibleItem,
  ItemDetail,
  MercadolibreApiRepository,
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
    // TODO: Implementar lógica de paginación utilizando res.paging, pendiente arreglar la meli api primero
    res.results.forEach((promotion) => {
      promotionCatalogs.push({
        promotionId: promotion.id,
        type: promotion.type,
        status: promotion.status,
        startDate: promotion.start_date,
        finishDate: promotion.finish_date,
        deadlineDate: promotion.deadline_date,
        name: promotion.name,
        subType: promotion.sub_type,
        fixedAmount: promotion.fixed_amount,
        minPurchaseAmount: promotion.min_purchase_amount,
      });
    });
    return promotionCatalogs;
  }

  async getEligibleItems(promotionId: string, promotionType: string): Promise<EligibleItem[]> {
    try {
      const response = await this.get<MeliPaginatedResponse<EligibleItem>>(`/meli/seller-promotions/${promotionId}/items?promotion_type=${promotionType}`);
      // TODO: Implementar lógica de paginación utilizando response.paging
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

  async activatePromotion(command: {
    promotionId: string;
    promotionType: string;
    itemId: string;
    offerId?: string;
  }): Promise<{ offerId?: string; status: string }> {
    const response = await this.post<{ offer_id?: string; status: string }>(
      `/meli/seller-promotions/items/${command.itemId}`,
      {
        promotion_id: command.promotionId,
        promotion_type: command.promotionType,
        offer_id: command.offerId,
      },
    );

    return {
      offerId: response.offer_id,
      status: response.status,
    };
  }

  async pauseOrDeletePromotion(command: {
    promotionId: string;
    itemId: string;
    offerId?: string;
    action: 'pause' | 'delete';
  }): Promise<{ status: string }> {
    return this.delete<{ status: string }>(`/meli/seller-promotions/items/${command.itemId}`);
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

  private async delete<T>(path: string): Promise<T> {
    const config = this.configService.get();
    const url = `${config.mercadolibreApiBaseUrl}${path}`;
    try {
      const response = await firstValueFrom(
        this.httpService.delete<T>(url, {
          timeout: config.mercadolibreApiTimeout,
          headers: this.headers(config.mercadolibreApiToken),
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
