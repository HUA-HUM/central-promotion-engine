import { AppConfig } from '@app/drivers/config/AppConfig';
import { AutomeliMlaControl } from '@core/interactors/promotion/AutomeliMlaControl';
import {
  IAPIMercadolibreApiRepository,
} from '@core/adapters/repositories/mercadolibre/IAPIMercadolibreApiRepository';
import { IAPIPriceApiRepository } from '@core/adapters/repositories/price-api/IAPIPriceApiRepository';
import { PromotionRepository } from '@core/adapters/repositories/IPromotionRepository';
import { Logger } from '@core/drivers/logger/Logger';
import { Promotion, PromotionStatus } from '@core/entities/Promotion';
import { PromotionType } from '@core/entities/PromotionCatalog';
import { mapWithConcurrency } from '@core/interactors/promotion/mapWithConcurrency';
import { PromotionModelsRegistry } from '@core/interactors/promotion/models/PromotionModelsRegistry';

export interface ActivateDealPromotionInput {
  promotionId: string;
  /**
   * MLAs to activate. `undefined`/`null` activates every synced item of the promotion.
   * An explicit empty array activates nothing.
   */
  mlas?: string[] | null;
  updatedBy: string;
}

export interface ActivateDealPromotionItemResult {
  itemId: string;
  status: 'success' | 'skipped' | 'failure';
  reason?: string;
  promotion?: Promotion;
}

export interface ActivateDealPromotionResult {
  promotionId: string;
  total: number;
  success: number;
  skipped: number;
  failure: number;
}

export interface ActivateDealPromotionBuilder {
  promotionRepository: PromotionRepository;
  mercadolibreApiRepository: IAPIMercadolibreApiRepository;
  priceApiRepository: IAPIPriceApiRepository;
  automeliMlaControl: AutomeliMlaControl;
  config: Pick<AppConfig, 'defaultMinProfit' | 'defaultMinProfitability'>;
}

export class ActivateDealPromotion {
  private static readonly SOURCE_PROCESS = 'manual-deal-activate';
  private static readonly CONCURRENCY = 5;
  private readonly promotionModelsRegistry = PromotionModelsRegistry.forActivation();

  constructor(private readonly builder: ActivateDealPromotionBuilder) {}

  async execute(input: ActivateDealPromotionInput): Promise<ActivateDealPromotionResult> {
    const promotions = await this.builder.promotionRepository.findByPromotionId(input.promotionId);

    if (promotions.length === 0) {
      throw new Error(`Promotion ${input.promotionId} has no synced items`);
    }

    if (promotions.some((promotion) => promotion.type !== PromotionType.DEAL)) {
      throw new Error(`Promotion ${input.promotionId} is not a DEAL promotion`);
    }

    const { targets, notFoundItemIds } = this.resolveTargets(promotions, input.mlas);

    const notFoundResults: ActivateDealPromotionItemResult[] = notFoundItemIds.map((itemId) => ({
      itemId,
      status: 'skipped',
      reason: `Item ${itemId} was not found among the synced items for promotion ${input.promotionId}`,
    }));

    const activeElsewhereItemIds = await this.builder.promotionRepository.findItemIdsWithActivePromotion(
      targets.map((promotion) => promotion.itemId),
      PromotionType.DEAL,
      input.promotionId,
    );

    const processedResults = await mapWithConcurrency(
      targets,
      ActivateDealPromotion.CONCURRENCY,
      (promotion) => this.processPromotion(promotion, input, activeElsewhereItemIds),
    );

    return this.summarize(input.promotionId, [...processedResults, ...notFoundResults]);
  }

  private resolveTargets(
    promotions: Promotion[],
    mlas: string[] | null | undefined,
  ): { targets: Promotion[]; notFoundItemIds: string[] } {
    if (mlas === undefined || mlas === null) {
      return { targets: promotions, notFoundItemIds: [] };
    }

    const byItemId = new Map(promotions.map((promotion) => [promotion.itemId, promotion]));
    const targets: Promotion[] = [];
    const notFoundItemIds: string[] = [];

    for (const itemId of new Set(mlas)) {
      const promotion = byItemId.get(itemId);
      if (promotion) {
        targets.push(promotion);
      } else {
        notFoundItemIds.push(itemId);
      }
    }

    return { targets, notFoundItemIds };
  }

  private summarize(
    promotionId: string,
    items: ActivateDealPromotionItemResult[],
  ): ActivateDealPromotionResult {
    return {
      promotionId,
      total: items.length,
      success: items.filter((item) => item.status === 'success').length,
      skipped: items.filter((item) => item.status === 'skipped').length,
      failure: items.filter((item) => item.status === 'failure').length,
    };
  }

  private async processPromotion(
    promotion: Promotion,
    input: ActivateDealPromotionInput,
    activeElsewhereItemIds: Set<string>,
  ): Promise<ActivateDealPromotionItemResult> {
    if (this.isDeadlineExpired(promotion)) {
      return this.skipped(
        promotion.itemId,
        input,
        `Promotion ${promotion.promotionId} deadline has already expired`,
      );
    }

    if (activeElsewhereItemIds.has(promotion.itemId)) {
      return this.skipped(
        promotion.itemId,
        input,
        `Another DEAL promotion is already active for item ${promotion.itemId}`,
      );
    }

    const dealPrice = this.resolveDealPrice(promotion);
    if (!Number.isFinite(dealPrice)) {
      return this.skipped(promotion.itemId, input, `Missing DEAL price for item ${promotion.itemId}`);
    }

    try {
      const revalidatedPromotion = await this.revalidatePromotion(promotion, dealPrice, input);

      if (!this.meetsProfitabilityRules(revalidatedPromotion, dealPrice)) {
        return this.skipped(
          promotion.itemId,
          input,
          `Item ${promotion.itemId} does not meet profitability rules at DEAL price ${dealPrice}`,
        );
      }

      const automeliResponse = await this.builder.automeliMlaControl.exclude({
        listingIds: [promotion.itemId],
      });

      const notMatched =
        (automeliResponse.matched ?? 0) === 0 ||
        (automeliResponse.notFound ?? []).includes(promotion.itemId);

      if (notMatched) {
        Logger.warn(
          JSON.stringify({
            message: 'Skipping manual DEAL activation because Automeli did not match the item',
            process: ActivateDealPromotion.SOURCE_PROCESS,
            promotionId: promotion.promotionId,
            itemId: promotion.itemId,
            automeliMatched: automeliResponse.matched ?? 0,
            automeliNotFound: automeliResponse.notFound ?? [],
          }),
        );

        return this.skipped(
          promotion.itemId,
          input,
          'Automeli did not match the item, DEAL was not activated to avoid being overwritten',
        );
      }

      const activationResponse = await this.builder.mercadolibreApiRepository.activatePromotion(
        this.promotionModelsRegistry.resolve(PromotionType.DEAL).buildActivationCommand(revalidatedPromotion),
      );

      const now = new Date();
      const activatedPromotion: Promotion = {
        ...revalidatedPromotion,
        status: PromotionStatus.ACTIVE,
        offerId: activationResponse.offerId ?? revalidatedPromotion.offerId,
        priceControl: {
          ...revalidatedPromotion.priceControl,
          controlledBy: 'DEAL',
          status: 'ACTIVE',
          updaterDisabled: true,
          disabledAt: revalidatedPromotion.priceControl?.disabledAt ?? now,
        },
        metadata: {
          ...revalidatedPromotion.metadata,
          activatedAt: now,
          updatedBy: input.updatedBy,
          sourceProcess: ActivateDealPromotion.SOURCE_PROCESS,
          statusReason: 'Promotion activated manually',
        },
        auditTrail: [
          ...revalidatedPromotion.auditTrail,
          {
            process: ActivateDealPromotion.SOURCE_PROCESS,
            status: PromotionStatus.ACTIVE,
            reason: 'Manual DEAL activation',
            executedAt: now,
          },
        ],
      };

      await this.builder.promotionRepository.update(activatedPromotion);

      Logger.info(
        JSON.stringify({
          message: 'DEAL promotion activated manually',
          process: ActivateDealPromotion.SOURCE_PROCESS,
          promotionId: activatedPromotion.promotionId,
          itemId: activatedPromotion.itemId,
          dealPrice,
          automeliStatus: automeliResponse.status,
          offerId: activatedPromotion.offerId,
          meliStatus: activationResponse.status,
          updatedBy: input.updatedBy,
        }),
      );

      return { itemId: promotion.itemId, status: 'success', promotion: activatedPromotion };
    } catch (error: unknown) {
      const reason = error instanceof Error ? error.message : 'Unknown DEAL activation error';
      const now = new Date();
      const failedPromotion: Promotion = {
        ...promotion,
        status: PromotionStatus.FAILED_ACTIVATION,
        metadata: {
          ...promotion.metadata,
          updatedBy: input.updatedBy,
          sourceProcess: ActivateDealPromotion.SOURCE_PROCESS,
          reason,
          statusReason: reason,
        },
        auditTrail: [
          ...promotion.auditTrail,
          {
            process: ActivateDealPromotion.SOURCE_PROCESS,
            status: PromotionStatus.FAILED_ACTIVATION,
            reason,
            executedAt: now,
          },
        ],
      };

      await this.builder.promotionRepository.update(failedPromotion);

      Logger.error(
        JSON.stringify({
          message: 'Manual DEAL activation failed',
          process: ActivateDealPromotion.SOURCE_PROCESS,
          promotionId: promotion.promotionId,
          itemId: promotion.itemId,
          reason,
        }),
      );

      return { itemId: promotion.itemId, status: 'failure', reason, promotion: failedPromotion };
    }
  }

  private async revalidatePromotion(
    promotion: Promotion,
    dealPrice: number,
    input: ActivateDealPromotionInput,
  ): Promise<Promotion> {
    const metrics = await this.builder.priceApiRepository.getMetrics({
      itemId: promotion.itemId,
      sku: promotion.sku,
      categoryId: promotion.categoryId,
      publicationType: promotion.listingTypeId,
      salePrice: dealPrice,
      meliContributionPercentage: promotion.terms?.resignation?.mercadolibre?.percentage,
    });

    return {
      ...promotion,
      prices: {
        ...promotion.prices,
        maxPrice: dealPrice,
      },
      economics: {
        ...promotion.economics,
        cost: metrics.cost ?? promotion.economics.cost,
        profit: metrics.profit ?? promotion.economics.profit,
        profitability: metrics.profitability ?? promotion.economics.profitability,
        margin: metrics.margin ?? promotion.economics.margin,
        profitable: metrics.profitable ?? promotion.economics.profitable,
        shouldPause: metrics.shouldPause ?? promotion.economics.shouldPause,
      },
      metadata: {
        ...promotion.metadata,
        updatedBy: input.updatedBy,
        sourceProcess: ActivateDealPromotion.SOURCE_PROCESS,
        statusReason: 'Promotion revalidated before manual DEAL activation',
      },
    };
  }

  private isDeadlineExpired(promotion: Promotion): boolean {
    if (!promotion.deadlineDate) {
      return false;
    }

    return new Date() > promotion.deadlineDate;
  }

  private resolveDealPrice(promotion: Promotion): number {
    return (
      promotion.prices.maxPrice ??
      promotion.prices.suggestedPrice ??
      promotion.prices.originalPrice ??
      Number.NEGATIVE_INFINITY
    );
  }

  private meetsProfitabilityRules(promotion: Promotion, salePrice: number): boolean {
    if (promotion.economics.profitable === false) {
      return false;
    }

    const { defaultMinProfit, defaultMinProfitability } = this.builder.config;

    const profitability = promotion.economics.profitability ?? Number.NEGATIVE_INFINITY;
    if (profitability < defaultMinProfitability) {
      return false;
    }

    const profit = promotion.economics.profit ?? Number.NEGATIVE_INFINITY;
    if (profit < defaultMinProfit) {
      return false;
    }

    const cost = promotion.economics.cost ?? Number.POSITIVE_INFINITY;
    return salePrice > cost;
  }

  private skipped(
    itemId: string,
    input: ActivateDealPromotionInput,
    reason: string,
  ): ActivateDealPromotionItemResult {
    Logger.info(
      JSON.stringify({
        message: 'Manual DEAL activation skipped',
        process: ActivateDealPromotion.SOURCE_PROCESS,
        promotionId: input.promotionId,
        itemId,
        reason,
      }),
    );

    return { itemId, status: 'skipped', reason };
  }
}
