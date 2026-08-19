import { AppConfig } from '@app/drivers/config/AppConfig';
import {
  IAPIAutomeliEnableUpdateRepository,
  IAPIAutomeliUpdateRepository,
} from '@core/adapters/repositories/automeli/IAPIAutomeliUpdateRepository';
import { IAPIMercadolibreApiRepository } from '@core/adapters/repositories/mercadolibre/IAPIMercadolibreApiRepository';
import { IAPIPriceApiRepository, PriceMetrics } from '@core/adapters/repositories/price-api/IAPIPriceApiRepository';
import { Logger } from '@core/drivers/logger/Logger';
import { Promotion, PromotionPriceControl } from '@core/entities/Promotion';
import { PromotionType } from '@core/entities/PromotionCatalog';

export interface DealPriceControlEvaluateInput {
  itemId: string;
  sku?: string;
  categoryId: string;
  publicationType: string;
  originalPrice?: number;
  itemPrice: number;
  currentDealPrice?: number;
  meliContributionPercentage?: number;
  metrics: PriceMetrics;
  existingPriceControl?: PromotionPriceControl;
}

export interface DealPriceControlBuilder {
  automeliUpdateRepository: IAPIAutomeliUpdateRepository;
  automeliEnableUpdateRepository: IAPIAutomeliEnableUpdateRepository;
  mercadolibreApiRepository: IAPIMercadolibreApiRepository;
  priceApiRepository: IAPIPriceApiRepository;
  config: Pick<
    AppConfig,
    | 'automeliSellerId'
    | 'dealPriceControlEnabled'
    | 'dealPriceControlMaxBaseIncreasePercentage'
    | 'defaultMinProfit'
    | 'defaultMinProfitability'
  >;
}

export class DealPriceControlService {
  private static readonly BINARY_SEARCH_MAX_ITERATIONS = 6;
  private static readonly BINARY_SEARCH_RELATIVE_TOLERANCE = 0.01;
  private static readonly BINARY_SEARCH_MIN_PRICE_TOLERANCE = 1;

  constructor(private readonly builder: DealPriceControlBuilder) {}

  async evaluate(input: DealPriceControlEvaluateInput): Promise<PromotionPriceControl> {
    if (!this.builder.config.dealPriceControlEnabled) {
      return this.skipped(input, 'DEAL price control is disabled (DEAL_PRICE_CONTROL_ENABLED=false)');
    }

    const referenceBasePrice = input.originalPrice ?? input.itemPrice;
    if (!referenceBasePrice) {
      return this.skipped(input, 'Missing reference base price for DEAL price control');
    }

    const currentDealPrice = input.currentDealPrice;
    if (!currentDealPrice) {
      return this.skipped(input, 'Missing DEAL price for DEAL price control');
    }

    const discountRatio = currentDealPrice / referenceBasePrice;
    if (!(discountRatio > 0 && discountRatio < 1)) {
      return this.skipped(input, `Invalid discount ratio ${discountRatio} for DEAL price control`);
    }

    if (this.isProfitable(input.metrics, currentDealPrice)) {
      return this.skipped(
        input,
        'DEAL is already profitable at max_discounted_price, no price control needed',
      );
    }

    const maxBasePrice =
      referenceBasePrice * (1 + this.builder.config.dealPriceControlMaxBaseIncreasePercentage);
    const maxDealPrice = maxBasePrice * discountRatio;

    const targetDealPrice = await this.searchTargetDealPrice(input, currentDealPrice, maxDealPrice);
    if (targetDealPrice === undefined) {
      return this.skipped(
        input,
        `Could not find a profitable DEAL price within the ${
          this.builder.config.dealPriceControlMaxBaseIncreasePercentage * 100
        }% base price increase limit`,
      );
    }

    const targetBasePrice = Math.ceil(targetDealPrice / discountRatio);

    const alreadyExcludedByThisDeal =
      input.existingPriceControl?.controlledBy === 'DEAL' &&
      input.existingPriceControl?.updaterDisabled === true;

    let automeliMatched: number | undefined;

    if (alreadyExcludedByThisDeal) {
      Logger.info(
        JSON.stringify({
          message: 'Skipping Automeli exclude call because the item is already meli_excluded by this DEAL',
          process: 'deal-price-control',
          itemId: input.itemId,
        }),
      );
    } else {
      const automeliResponse = await this.builder.automeliUpdateRepository.update({
        sellerId: this.builder.config.automeliSellerId,
        listingIds: [input.itemId],
        includeNotFound: true,
      });

      automeliMatched = automeliResponse.matched ?? 0;

      const notMatched =
        (automeliResponse.matched ?? 0) === 0 || (automeliResponse.notFound ?? []).includes(input.itemId);

      if (notMatched) {
        Logger.warn(
          JSON.stringify({
            message: 'Skipping DEAL price control because Automeli did not match the item',
            process: 'deal-price-control',
            itemId: input.itemId,
            automeliMatched: automeliResponse.matched ?? 0,
            automeliNotFound: automeliResponse.notFound ?? [],
          }),
        );

        return this.skipped(
          input,
          'Automeli did not match the item, price was not updated to avoid being overwritten',
        );
      }
    }

    const now = new Date();
    await this.builder.mercadolibreApiRepository.updatePrice({
      itemId: input.itemId,
      price: targetBasePrice,
    });

    Logger.info(
      JSON.stringify({
        message: 'DEAL price control updated base price',
        process: 'deal-price-control',
        itemId: input.itemId,
        targetDealPrice,
        targetBasePrice,
        discountRatio,
        maxBasePrice,
        automeliMatched,
        status: 'PRICE_UPDATED_PENDING_SYNC',
      }),
    );

    return {
      controlledBy: 'DEAL',
      status: 'PRICE_UPDATED_PENDING_SYNC',
      updaterDisabled: true,
      disabledAt: alreadyExcludedByThisDeal ? input.existingPriceControl?.disabledAt ?? now : now,
      basePriceBeforeControl: input.itemPrice,
      currentBasePrice: targetBasePrice,
      lastCalculatedDiscountedPrice: targetDealPrice,
      lastPriceUpdateAt: now,
      reason: 'Base price increased to keep the DEAL profitable while excluded from Automeli',
    };
  }

  async release(promotion: Promotion): Promise<PromotionPriceControl | undefined> {
    const priceControl = promotion.priceControl;

    if (
      promotion.type !== PromotionType.DEAL ||
      priceControl?.controlledBy !== 'DEAL' ||
      priceControl?.updaterDisabled !== true
    ) {
      return priceControl;
    }

    await this.builder.automeliEnableUpdateRepository.enableUpdate({
      sellerId: this.builder.config.automeliSellerId,
      listingIds: [promotion.itemId],
      includeNotFound: true,
    });

    Logger.info(
      JSON.stringify({
        message: 'DEAL price control released Automeli',
        process: 'deal-price-control',
        itemId: promotion.itemId,
        promotionId: promotion.promotionId,
      }),
    );

    return {
      ...priceControl,
      status: 'RELEASED',
      updaterDisabled: false,
      releasedAt: new Date(),
    };
  }

  private isProfitable(metrics: PriceMetrics, salePrice: number): boolean {
    const { defaultMinProfit, defaultMinProfitability } = this.builder.config;

    return (
      metrics.profitable === true &&
      (metrics.profitability ?? Number.NEGATIVE_INFINITY) >= defaultMinProfitability &&
      (metrics.profit ?? Number.NEGATIVE_INFINITY) >= defaultMinProfit &&
      salePrice > (metrics.cost ?? 0)
    );
  }

  private async searchTargetDealPrice(
    input: DealPriceControlEvaluateInput,
    currentDealPrice: number,
    maxDealPrice: number,
  ): Promise<number | undefined> {
    if (maxDealPrice <= currentDealPrice) {
      return undefined;
    }

    const hiMetrics = await this.fetchMetrics(input, maxDealPrice);

    Logger.info(
      JSON.stringify({
        message: 'DEAL price control target search attempt',
        process: 'deal-price-control',
        itemId: input.itemId,
        triedPrice: maxDealPrice,
        profitable: this.isProfitable(hiMetrics, maxDealPrice),
      }),
    );

    if (!this.isProfitable(hiMetrics, maxDealPrice)) {
      return undefined;
    }

    let lo = currentDealPrice;
    let hi = maxDealPrice;
    let bestPrice = maxDealPrice;

    const tolerance = Math.max(
      DealPriceControlService.BINARY_SEARCH_MIN_PRICE_TOLERANCE,
      currentDealPrice * DealPriceControlService.BINARY_SEARCH_RELATIVE_TOLERANCE,
    );

    for (
      let iteration = 0;
      iteration < DealPriceControlService.BINARY_SEARCH_MAX_ITERATIONS && hi - lo > tolerance;
      iteration += 1
    ) {
      const mid = Math.floor((lo + hi) / 2);
      const metrics = await this.fetchMetrics(input, mid);
      const profitable = this.isProfitable(metrics, mid);

      Logger.info(
        JSON.stringify({
          message: 'DEAL price control target search attempt',
          process: 'deal-price-control',
          itemId: input.itemId,
          iteration,
          triedPrice: mid,
          profitable,
        }),
      );

      if (profitable) {
        bestPrice = mid;
        hi = mid;
      } else {
        lo = mid;
      }
    }

    return bestPrice;
  }

  private async fetchMetrics(
    input: DealPriceControlEvaluateInput,
    salePrice: number,
  ): Promise<PriceMetrics> {
    return this.builder.priceApiRepository.getMetrics({
      itemId: input.itemId,
      sku: input.sku,
      categoryId: input.categoryId,
      publicationType: input.publicationType,
      salePrice,
      meliContributionPercentage: input.meliContributionPercentage,
    });
  }

  private skipped(input: DealPriceControlEvaluateInput, reason: string): PromotionPriceControl {
    Logger.info(
      JSON.stringify({
        message: 'DEAL price control skipped',
        process: 'deal-price-control',
        itemId: input.itemId,
        status: 'SKIPPED',
        reason,
      }),
    );

    return {
      controlledBy: 'DEAL',
      status: 'SKIPPED',
      reason,
    };
  }
}
