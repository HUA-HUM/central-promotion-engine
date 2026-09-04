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

interface ActivateDealPromotionCounters {
  total: number;
  success: number;
  skipped: number;
  failure: number;
}

export class ActivateDealPromotion {
  private static readonly SOURCE_PROCESS = 'manual-deal-activate';
  private static readonly CONCURRENCY = 5;
  /**
   * How many `Promotion` docs are held in memory at once. A DEAL can have hundreds of thousands
   * of synced items; loading them all in one array (plus a same-sized array of results) is what
   * OOM-kills the process. Batches are processed and discarded one at a time — only the running
   * counters below survive across batches, so memory stays flat regardless of promotion size.
   */
  private static readonly DB_BATCH_SIZE = 500;
  /**
   * Only promotions in these statuses can be manually activated — same policy the automatic
   * `ActivatePromotions` flow applies (`findPendingActivationBatch`). Anything already ACTIVE,
   * PAUSED, DELETED or FINISHED is reported as skipped instead of re-hitting Mercado Libre /
   * Automeli and risking a false FAILED_ACTIVATION on an item that is actually live.
   */
  private static readonly ACTIVATABLE_STATUSES: PromotionStatus[] = [
    PromotionStatus.SYNCED,
    PromotionStatus.FAILED_ACTIVATION,
  ];
  private readonly promotionModelsRegistry = PromotionModelsRegistry.forActivation();

  constructor(private readonly builder: ActivateDealPromotionBuilder) {}

  async execute(input: ActivateDealPromotionInput): Promise<ActivateDealPromotionResult> {
    // Existence/type validation reads a single doc — every Promotion under a promotionId shares
    // the same `type`, so this is enough to validate without paging through everything.
    const [sample] = await this.builder.promotionRepository.findByPromotionIdBatch(
      input.promotionId,
      undefined,
      1,
    );

    if (!sample) {
      throw new Error(`Promotion ${input.promotionId} has no synced items`);
    }

    if (sample.type !== PromotionType.DEAL) {
      throw new Error(`Promotion ${input.promotionId} is not a DEAL promotion`);
    }

    const counters: ActivateDealPromotionCounters = { total: 0, success: 0, skipped: 0, failure: 0 };

    if (input.mlas === undefined || input.mlas === null) {
      await this.processAllSyncedItems(input, counters);
    } else if (input.mlas.length > 0) {
      await this.processExplicitMlas(input, input.mlas, counters);
    }
    // input.mlas === [] activates nothing — counters stay at 0.

    return { promotionId: input.promotionId, ...counters };
  }

  /** `mlas` omitted/null: page through every synced item of the promotion, DB_BATCH_SIZE at a time. */
  private async processAllSyncedItems(
    input: ActivateDealPromotionInput,
    counters: ActivateDealPromotionCounters,
  ): Promise<void> {
    let afterId: string | undefined;

    while (true) {
      const batch = await this.builder.promotionRepository.findByPromotionIdBatch(
        input.promotionId,
        afterId,
        ActivateDealPromotion.DB_BATCH_SIZE,
      );

      if (batch.length === 0) {
        break;
      }

      await this.processBatch(batch, input, counters);
      afterId = this.resolveLastProcessedId(batch, afterId);
    }
  }

  /** `mlas` given explicitly: chunk it so a caller passing a huge list can't blow up memory either. */
  private async processExplicitMlas(
    input: ActivateDealPromotionInput,
    mlas: string[],
    counters: ActivateDealPromotionCounters,
  ): Promise<void> {
    const uniqueMlas = [...new Set(mlas)];

    for (const chunk of this.chunkArray(uniqueMlas, ActivateDealPromotion.DB_BATCH_SIZE)) {
      const found = await this.builder.promotionRepository.findByItemIds(input.promotionId, chunk);
      await this.processBatch(found, input, counters);

      const foundItemIds = new Set(found.map((promotion) => promotion.itemId));
      for (const itemId of chunk) {
        if (!foundItemIds.has(itemId)) {
          counters.total += 1;
          counters.skipped += 1;
        }
      }
    }
  }

  /** Processes one bounded batch end-to-end and folds its results into `counters`, then drops them. */
  private async processBatch(
    batch: Promotion[],
    input: ActivateDealPromotionInput,
    counters: ActivateDealPromotionCounters,
  ): Promise<void> {
    if (batch.length === 0) {
      return;
    }

    const activeElsewhereItemIds = await this.builder.promotionRepository.findItemIdsWithActivePromotion(
      batch.map((promotion) => promotion.itemId),
      PromotionType.DEAL,
      input.promotionId,
    );

    const results = await mapWithConcurrency(batch, ActivateDealPromotion.CONCURRENCY, (promotion) =>
      this.processPromotion(promotion, input, activeElsewhereItemIds),
    );

    counters.total += results.length;
    for (const result of results) {
      if (result.status === 'success') {
        counters.success += 1;
      } else if (result.status === 'failure') {
        counters.failure += 1;
      } else {
        counters.skipped += 1;
      }
    }
  }

  private resolveLastProcessedId(promotions: Promotion[], fallback?: string): string | undefined {
    const lastPromotion = promotions[promotions.length - 1] as Promotion & {
      _id?: { toString(): string };
    };

    return lastPromotion._id?.toString() ?? fallback;
  }

  private chunkArray<T>(items: T[], size: number): T[][] {
    const chunks: T[][] = [];

    for (let index = 0; index < items.length; index += size) {
      chunks.push(items.slice(index, index + size));
    }

    return chunks;
  }

  private async processPromotion(
    promotion: Promotion,
    input: ActivateDealPromotionInput,
    activeElsewhereItemIds: Set<string>,
  ): Promise<ActivateDealPromotionItemResult> {
    if (!ActivateDealPromotion.ACTIVATABLE_STATUSES.includes(promotion.status)) {
      return this.skipped(
        promotion.itemId,
        input,
        `Item ${promotion.itemId} is in status ${promotion.status}; only ${ActivateDealPromotion.ACTIVATABLE_STATUSES.join(
          '/',
        )} promotions can be activated`,
      );
    }

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
