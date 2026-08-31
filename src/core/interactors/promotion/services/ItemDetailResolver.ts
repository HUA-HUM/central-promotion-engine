import { IAPICatalogMeliApiRepository } from '@core/adapters/repositories/catalog-meli/IAPICatalogMeliApiRepository';
import {
  IAPIMercadolibreApiRepository,
  ItemDetail,
} from '@core/adapters/repositories/mercadolibre/IAPIMercadolibreApiRepository';
import { Logger } from '@core/drivers/logger/Logger';

export interface ItemDetailResolverBuilder {
  mercadolibreApiRepository: IAPIMercadolibreApiRepository;
  catalogMeliApiRepository?: IAPICatalogMeliApiRepository;
  enabled?: boolean;
}

export interface ItemDetailResolveStats {
  totalItems: number;
  /** Items whose detail was served by the Catalog-Meli lookup. */
  catalogResolvedCount: number;
  /** Items whose detail was served by the Mercado Libre fallback. */
  meliFallbackItemCount: number;
  /** True when the Catalog-Meli call failed and the whole batch fell back to Mercado Libre. */
  catalogFailed: boolean;
  /** True when Catalog-Meli was skipped entirely (disabled or not wired). */
  catalogDisabled: boolean;
}

export interface ItemDetailResolveResult {
  details: ItemDetail[];
  stats: ItemDetailResolveStats;
}

/**
 * Resolves item detail (sku / categoryId / listingTypeId / price) preferring the Catalog-Meli
 * analytics API and falling back to the Mercado Libre API:
 *  - if the Catalog-Meli call fails, the whole batch falls back to Mercado Libre;
 *  - items Catalog-Meli does not return (`not_found`) fall back to Mercado Libre per item.
 */
export class ItemDetailResolver {
  private readonly enabled: boolean;

  constructor(private readonly builder: ItemDetailResolverBuilder) {
    this.enabled = Boolean(builder.enabled && builder.catalogMeliApiRepository);
  }

  async resolveBulk(itemIds: string[]): Promise<ItemDetailResolveResult> {
    const baseStats: ItemDetailResolveStats = {
      totalItems: itemIds.length,
      catalogResolvedCount: 0,
      meliFallbackItemCount: 0,
      catalogFailed: false,
      catalogDisabled: !this.enabled,
    };

    if (itemIds.length === 0) {
      return { details: [], stats: baseStats };
    }

    if (!this.enabled || !this.builder.catalogMeliApiRepository) {
      const details = await this.builder.mercadolibreApiRepository.getItemDetailsBulk(itemIds);
      return {
        details,
        stats: { ...baseStats, meliFallbackItemCount: itemIds.length },
      };
    }

    let products: ItemDetail[];
    let notFound: string[];

    try {
      const result = await this.builder.catalogMeliApiRepository.lookupItemDetails(itemIds);
      products = result.products;
      notFound = result.notFound;
    } catch (error) {
      Logger.warn(
        JSON.stringify({
          message: 'Catalog-Meli item detail lookup failed, falling back to Mercado Libre for the whole batch',
          service: 'catalog-meli-api',
          itemCount: itemIds.length,
          reason: error instanceof Error ? error.message : 'Unknown catalog-meli error',
        }),
      );
      const details = await this.builder.mercadolibreApiRepository.getItemDetailsBulk(itemIds);
      return {
        details,
        stats: { ...baseStats, catalogFailed: true, meliFallbackItemCount: itemIds.length },
      };
    }

    if (notFound.length === 0) {
      return {
        details: products,
        stats: { ...baseStats, catalogResolvedCount: products.length },
      };
    }

    Logger.info(
      JSON.stringify({
        message: 'Catalog-Meli did not return some items, falling back to Mercado Libre for those',
        service: 'catalog-meli-api',
        itemCount: itemIds.length,
        fallbackCount: notFound.length,
      }),
    );

    const fallbackDetails = await this.builder.mercadolibreApiRepository.getItemDetailsBulk(notFound);
    return {
      details: products.concat(fallbackDetails),
      stats: {
        ...baseStats,
        catalogResolvedCount: products.length,
        meliFallbackItemCount: notFound.length,
      },
    };
  }

  async resolveOne(itemId: string): Promise<ItemDetail> {
    if (!this.enabled || !this.builder.catalogMeliApiRepository) {
      return this.builder.mercadolibreApiRepository.getItemDetail(itemId);
    }

    try {
      const { products } = await this.builder.catalogMeliApiRepository.lookupItemDetails([itemId]);
      const detail = products.find((product) => product.itemId === itemId);

      if (detail) {
        return detail;
      }
    } catch (error) {
      Logger.warn(
        JSON.stringify({
          message: 'Catalog-Meli item detail lookup failed, falling back to Mercado Libre',
          service: 'catalog-meli-api',
          itemId,
          reason: error instanceof Error ? error.message : 'Unknown catalog-meli error',
        }),
      );
    }

    return this.builder.mercadolibreApiRepository.getItemDetail(itemId);
  }
}
