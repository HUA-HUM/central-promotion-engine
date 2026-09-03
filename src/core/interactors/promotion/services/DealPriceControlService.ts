import { AppConfig } from '@app/drivers/config/AppConfig';
import {
  IAPIAutomeliEnableUpdateRepository,
  IAPIAutomeliUpdateRepository,
} from '@core/adapters/repositories/automeli/IAPIAutomeliUpdateRepository';
import { IAPIMercadolibreApiRepository } from '@core/adapters/repositories/mercadolibre/IAPIMercadolibreApiRepository';
import { PriceMetrics } from '@core/adapters/repositories/price-api/IAPIPriceApiRepository';
import { Logger } from '@core/drivers/logger/Logger';
import { Promotion, PromotionPriceControl } from '@core/entities/Promotion';
import { PromotionType } from '@core/entities/PromotionCatalog';

export interface DealPriceControlEvaluateInput {
  itemId: string;
  promotionId?: string;
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
  /**
   * Extra profitability margin (percentage points) the price-control target aims for, on top of
   * the global `defaultMinProfitability`. Buffer against cost drift — when ML recomposes the deal
   * price upward, its commission on that higher price raises `cost` (~20% marginal), so a target
   * at plain breakeven lands slightly negative on the next sync. 5pp gives it headroom.
   */
  private static readonly TARGET_MIN_PROFITABILITY_BUFFER_PERCENT = 6;

  /** Hours to wait for ML to reflect a base-price bump before giving up on the item. */
  private static readonly PENDING_SYNC_MAX_WAIT_HOURS = 24;

  /**
   * Consecutive base-price bumps allowed before giving up. Reset to 0 once the item settles
   * profitable, so an item that drifts negative months later still gets a fresh set of tries.
   */
  private static readonly MAX_CONSECUTIVE_BUMPS = 3;

  constructor(private readonly builder: DealPriceControlBuilder) {
    if (!builder.config.dealPriceControlEnabled) {
      Logger.info(
        JSON.stringify({
          message: 'DEAL price control is disabled, all items will skip it (DEAL_PRICE_CONTROL_ENABLED=false)',
          process: 'deal-price-control',
        }),
      );
    }
  }

  async evaluate(input: DealPriceControlEvaluateInput): Promise<PromotionPriceControl> {
    if (!this.builder.config.dealPriceControlEnabled) {
      return this.resolveSkippedPriceControl(
        input,
        'DEAL price control is disabled (DEAL_PRICE_CONTROL_ENABLED=false)',
      );
    }

    const existing = input.existingPriceControl;

    // Terminal: we already gave up on this item. It stays frozen until a manual DEAL
    // deactivation releases it (`release()` re-enables Automeli and resets the control).
    if (existing?.controlledBy === 'DEAL' && existing.status === 'EXHAUSTED') {
      return existing;
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

    // Instrumentation: for items we already bumped and are waiting on, emit one line per sync
    // with expected-vs-actual so we can see whether/how fast ML recomposes max_discounted_price.
    this.logPendingSyncReEvaluation(input, referenceBasePrice, currentDealPrice, discountRatio);

    const cost = input.metrics.cost;
    if (cost === undefined || !Number.isFinite(cost) || cost <= 0) {
      // Common for brand-new listings price-api hasn't ingested yet — it returns cost 0.
      return this.skipped(
        input,
        'Missing or non-positive cost from price-api, cannot evaluate DEAL price control',
      );
    }

    // Reconcile an in-flight bump before computing anything new: don't re-bump while ML is
    // still propagating the last change, and mark converged/failed items terminal.
    if (existing?.controlledBy === 'DEAL' && existing.status === 'PRICE_UPDATED_PENDING_SYNC') {
      const decision = this.reconcilePendingSync(input, existing, referenceBasePrice, currentDealPrice);
      if (decision !== 'proceed') {
        return decision;
      }
    }

    // No pending record but the item's live price is already above what ML's promotion catalog
    // reports as its original price → a price change is still propagating (DB was reset, or the
    // price moved outside this service). currentDealPrice / metrics / discountRatio are all
    // derived from that stale original, so acting now would target a wrong — sometimes lower —
    // price. Wait it out. (Pending items are already handled by reconcilePendingSync above.)
    if (input.originalPrice !== undefined && input.itemPrice > input.originalPrice * 1.005) {
      return this.skipped(
        input,
        `Item price ${input.itemPrice} is ahead of Mercado Libre catalog original ${input.originalPrice}; waiting for ML to reconcile`,
      );
    }

    if (this.isProfitable(input.metrics, currentDealPrice)) {
      // The overwhelming majority of DEAL items land here on every sync; logging one line
      // each would drown the process, so this "no-op" skip is intentionally silent.
      return this.resolveSkippedPriceControl(
        input,
        'DEAL is already profitable at max_discounted_price, no price control needed',
      );
    }

    // Cap the total base-price increase against the price BEFORE any DEAL control ever touched
    // this item — not against ML's (by then already inflated) `original_price`. Otherwise the
    // ceiling ratchets up with every bump and the +30% limit becomes meaningless.
    const originalBasePrice = existing?.basePriceBeforeControl ?? input.itemPrice;
    const maxBasePrice =
      originalBasePrice * (1 + this.builder.config.dealPriceControlMaxBaseIncreasePercentage);
    const maxDealPrice = maxBasePrice * discountRatio;

    const target = this.resolveTargetDealPrice(cost, currentDealPrice, maxDealPrice);
    if (!target.withinCap) {
      const diagnostics = {
        // How far underwater is the item — is the required base bump 5% over the cap or 200%?
        requiredDealPrice: target.requiredDealPrice,
        requiredBasePrice: Math.ceil(target.requiredDealPrice / discountRatio),
        requiredBaseIncreasePct: DealPriceControlService.pctChange(
          target.requiredDealPrice / discountRatio,
          originalBasePrice,
        ),
        maxBasePrice,
        maxDealPrice,
        currentDealPrice,
        costAtCurrentDealPrice: cost,
      };

      // Already bumped, ML applied it (reconcilePendingSync let us through), still not profitable,
      // and the next target is over the cap → this item can't be saved. Terminal, don't retry.
      if (existing?.status === 'PRICE_UPDATED_PENDING_SYNC') {
        Logger.warn(
          JSON.stringify({
            message: 'DEAL price control giving up: base at cap and DEAL still not profitable',
            process: 'deal-price-control',
            itemId: input.itemId,
            promotionId: input.promotionId ?? null,
            bumpCount: existing.bumpCount ?? null,
            ...diagnostics,
          }),
        );
        return {
          ...existing,
          status: 'EXHAUSTED',
          reason: `Base price would need +${Math.round(
            (diagnostics.requiredBaseIncreasePct ?? 0) * 100,
          )}% to be profitable, over the ${
            this.builder.config.dealPriceControlMaxBaseIncreasePercentage * 100
          }% limit`,
        };
      }

      return this.skipped(
        input,
        `Could not find a profitable DEAL price within the ${
          this.builder.config.dealPriceControlMaxBaseIncreasePercentage * 100
        }% base price increase limit`,
        diagnostics,
      );
    }

    const targetDealPrice = target.requiredDealPrice;
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

    // `originalBasePrice` (computed above for the cap) is the preserved pre-control anchor.
    const basePriceBeforeControl = originalBasePrice;
    const originalMaxDiscountedPrice = existing?.originalMaxDiscountedPrice ?? currentDealPrice;
    const bumpCount = (existing?.bumpCount ?? 0) + 1;
    const firstBumpAt = existing?.firstBumpAt ?? now;

    Logger.info(
      JSON.stringify({
        message: 'DEAL price control updated base price',
        process: 'deal-price-control',
        itemId: input.itemId,
        promotionId: input.promotionId ?? null,
        targetDealPrice,
        targetBasePrice,
        previousBasePrice: existing?.currentBasePrice ?? input.itemPrice,
        discountRatio,
        maxBasePrice,
        bumpCount,
        cumulativeBaseIncreasePct: DealPriceControlService.pctChange(
          targetBasePrice,
          basePriceBeforeControl,
        ),
        originalMaxDiscountedPrice,
        costAtCurrentDealPrice: cost,
        targetMinProfitabilityPercent:
          this.builder.config.defaultMinProfitability +
          DealPriceControlService.TARGET_MIN_PROFITABILITY_BUFFER_PERCENT,
        targetBaseIncreasePct: DealPriceControlService.pctChange(targetBasePrice, referenceBasePrice),
        automeliMatched,
        status: 'PRICE_UPDATED_PENDING_SYNC',
      }),
    );

    return {
      controlledBy: 'DEAL',
      status: 'PRICE_UPDATED_PENDING_SYNC',
      updaterDisabled: true,
      disabledAt: alreadyExcludedByThisDeal ? existing?.disabledAt ?? now : now,
      basePriceBeforeControl,
      currentBasePrice: targetBasePrice,
      lastCalculatedDiscountedPrice: targetDealPrice,
      lastPriceUpdateAt: now,
      originalMaxDiscountedPrice,
      bumpCount,
      firstBumpAt,
      reason: 'Base price increased to keep the DEAL profitable while excluded from Automeli',
    };
  }

  /**
   * Decide what to do with an item already in PRICE_UPDATED_PENDING_SYNC, before touching price
   * again. Returns a terminal/holding `PromotionPriceControl`, or `'proceed'` to fall through to
   * a fresh target computation + bump.
   */
  private reconcilePendingSync(
    input: DealPriceControlEvaluateInput,
    existing: PromotionPriceControl,
    referenceBasePrice: number,
    currentDealPrice: number,
  ): PromotionPriceControl | 'proceed' {
    const baseWeSet = existing.currentBasePrice;
    const mlApplied = baseWeSet === undefined || referenceBasePrice >= baseWeSet * 0.999;

    if (!mlApplied) {
      const hoursWaiting = existing.lastPriceUpdateAt
        ? (Date.now() - new Date(existing.lastPriceUpdateAt).getTime()) / 3_600_000
        : 0;

      if (hoursWaiting >= DealPriceControlService.PENDING_SYNC_MAX_WAIT_HOURS) {
        Logger.warn(
          JSON.stringify({
            message: 'DEAL price control giving up: Mercado Libre never applied the base price change',
            process: 'deal-price-control',
            itemId: input.itemId,
            promotionId: input.promotionId ?? null,
            basePriceWeSet: baseWeSet ?? null,
            currentOriginalPrice: referenceBasePrice,
            hoursWaiting,
          }),
        );
        return {
          ...existing,
          status: 'EXHAUSTED',
          reason: `Mercado Libre did not apply the base price change after ${Math.round(hoursWaiting)}h`,
        };
      }

      // Still within the wait window — hold everything as-is, ML is just lagging.
      return { ...existing, reason: 'Waiting for Mercado Libre to apply the base price change' };
    }

    if (this.isProfitable(input.metrics, currentDealPrice)) {
      return {
        ...existing,
        status: 'SETTLED',
        bumpCount: 0,
        reason: 'DEAL profitable after price control',
      };
    }

    // Not profitable. Did ML recompose the deal price roughly to what the discount ratio we
    // bumped against implied? If ML gave a *worse* deal price (it raised the required discount),
    // bumping more just feeds a bigger discount — and the ratio often bounces back a sync later.
    // Hold within the wait window instead of re-bumping or giving up on a transient reading.
    const expected = existing.lastCalculatedDiscountedPrice;
    const recomposedAsExpected = expected !== undefined && expected > 0 && currentDealPrice >= expected * 0.98;

    const hoursSinceLastBump = existing.lastPriceUpdateAt
      ? (Date.now() - new Date(existing.lastPriceUpdateAt).getTime()) / 3_600_000
      : 0;

    if (!recomposedAsExpected) {
      if (hoursSinceLastBump >= DealPriceControlService.PENDING_SYNC_MAX_WAIT_HOURS) {
        Logger.warn(
          JSON.stringify({
            message: 'DEAL price control giving up: Mercado Libre keeps giving a worse deal price than the bump implied',
            process: 'deal-price-control',
            itemId: input.itemId,
            promotionId: input.promotionId ?? null,
            expectedMaxDiscountedPrice: expected ?? null,
            currentMaxDiscountedPrice: currentDealPrice,
            hoursSinceLastBump,
          }),
        );
        return {
          ...existing,
          status: 'EXHAUSTED',
          reason: 'Mercado Libre keeps raising the required discount when the base price goes up',
        };
      }
      return {
        ...existing,
        reason: 'Mercado Libre gave a worse deal price than the bump implied; waiting to see if it settles',
      };
    }

    // ML recomposed as expected but the item is still not profitable → the cost rose since the
    // bump. Bump again, up to the limit.
    if ((existing.bumpCount ?? 0) >= DealPriceControlService.MAX_CONSECUTIVE_BUMPS) {
      Logger.warn(
        JSON.stringify({
          message: 'DEAL price control giving up: still not profitable after repeated bumps',
          process: 'deal-price-control',
          itemId: input.itemId,
          promotionId: input.promotionId ?? null,
          bumpCount: existing.bumpCount ?? null,
          currentDealPrice,
          cost: input.metrics.cost ?? null,
        }),
      );
      return {
        ...existing,
        status: 'EXHAUSTED',
        reason: `Still not profitable after ${existing.bumpCount} base price bumps`,
      };
    }

    return 'proceed';
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

  /** `a / b`, or null when the result would not be a finite number. */
  private static safeRatio(a: number | undefined, b: number | undefined): number | null {
    if (a === undefined || b === undefined || !Number.isFinite(a) || !Number.isFinite(b) || b === 0) {
      return null;
    }

    return a / b;
  }

  /** `now / before - 1` (fractional change), or null when `before` is missing/zero. */
  private static pctChange(now: number, before: number | undefined): number | null {
    const ratio = DealPriceControlService.safeRatio(now, before);

    return ratio === null ? null : ratio - 1;
  }

  /**
   * One structured line per sync for a controlled item that still needs watching: what we
   * targeted on the last bump vs. what Mercado Libre reports now. Fires while pending, and once
   * more when a SETTLED item drifts back to unprofitable; a SETTLED item that is still fine
   * stays silent.
   */
  private logPendingSyncReEvaluation(
    input: DealPriceControlEvaluateInput,
    referenceBasePrice: number,
    currentDealPrice: number,
    discountRatio: number,
  ): void {
    const existing = input.existingPriceControl;
    if (existing?.status !== 'PRICE_UPDATED_PENDING_SYNC' && existing?.status !== 'SETTLED') {
      return;
    }

    const profitableNow = this.isProfitable(input.metrics, currentDealPrice);
    if (existing.status === 'SETTLED' && profitableNow) {
      return;
    }

    const originalBasePrice = existing.basePriceBeforeControl;
    const originalMaxDiscounted = existing.originalMaxDiscountedPrice;
    const baseWeSet = existing.currentBasePrice;
    const expectedMaxDiscounted = existing.lastCalculatedDiscountedPrice;

    Logger.info(
      JSON.stringify({
        message: 'DEAL price control re-evaluation',
        process: 'deal-price-control',
        itemId: input.itemId,
        promotionId: input.promotionId ?? null,
        bumpCount: existing.bumpCount ?? null,
        firstBumpAt: existing.firstBumpAt ?? null,
        lastPriceUpdateAt: existing.lastPriceUpdateAt ?? null,

        // what the previous bump aimed for
        basePriceWeSet: baseWeSet ?? null,
        discountRatioWeAssumed: DealPriceControlService.safeRatio(expectedMaxDiscounted, baseWeSet),
        expectedMaxDiscountedPrice: expectedMaxDiscounted ?? null,

        // what ML reports on this sync
        currentOriginalPrice: referenceBasePrice,
        currentMaxDiscountedPrice: currentDealPrice,
        currentDiscountRatio: discountRatio,
        impliedDiscountPct: 1 - discountRatio,

        // did ML apply our base change, and how close is the deal price to what we targeted
        mlAppliedBaseChange:
          baseWeSet === undefined ? null : referenceBasePrice >= baseWeSet * 0.999,
        maxDiscountedVsExpected: DealPriceControlService.safeRatio(
          currentDealPrice,
          expectedMaxDiscounted,
        ),

        // cumulative movement since before any DEAL control touched this item
        originalBasePrice: originalBasePrice ?? null,
        originalMaxDiscountedPrice: originalMaxDiscounted ?? null,
        cumulativeBaseIncreasePct: DealPriceControlService.pctChange(referenceBasePrice, originalBasePrice),
        cumulativeMaxDiscountedIncreasePct: DealPriceControlService.pctChange(
          currentDealPrice,
          originalMaxDiscounted,
        ),
        mlRecomposeRatio: DealPriceControlService.safeRatio(
          originalMaxDiscounted === undefined ? NaN : currentDealPrice - originalMaxDiscounted,
          originalBasePrice === undefined ? NaN : referenceBasePrice - originalBasePrice,
        ),

        // profitability on this sync
        cost: input.metrics.cost ?? null,
        profit: input.metrics.profit ?? null,
        profitability: input.metrics.profitability ?? null,
        profitableNow,
        priceControlStatus: existing.status,
      }),
    );
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

  /**
   * Lowest DEAL price that clears `defaultMinProfit` and `defaultMinProfitability` + the safety
   * buffer. price-api's `cost` does not depend on `salePrice` (confirmed in prod: identical at
   * the current deal price and at +30%), so the target is a closed form of the `cost` already
   * computed in the sync's bulk call — no price-api round-trips here. `withinCap` says whether
   * the price fits the base-increase limit.
   */
  private resolveTargetDealPrice(
    cost: number,
    currentDealPrice: number,
    maxDealPrice: number,
  ): { requiredDealPrice: number; withinCap: boolean } {
    const { defaultMinProfit, defaultMinProfitability } = this.builder.config;
    const minProfitabilityFraction =
      (defaultMinProfitability + DealPriceControlService.TARGET_MIN_PROFITABILITY_BUFFER_PERCENT) /
      100;

    // profit(P) = P − cost ≥ defaultMinProfit
    const priceForProfit = cost + defaultMinProfit;
    // profitability(P) = (P − cost) / P ≥ m   →   P ≥ cost / (1 − m)
    const priceForProfitability =
      minProfitabilityFraction < 1
        ? cost / (1 - minProfitabilityFraction)
        : Number.POSITIVE_INFINITY;

    const requiredDealPrice = Math.ceil(Math.max(priceForProfit, priceForProfitability));

    return {
      requiredDealPrice,
      withinCap: requiredDealPrice > currentDealPrice && requiredDealPrice <= maxDealPrice,
    };
  }

  private skipped(
    input: DealPriceControlEvaluateInput,
    reason: string,
    extra?: Record<string, unknown>,
  ): PromotionPriceControl {
    const priceControl = this.resolveSkippedPriceControl(input, reason);

    Logger.info(
      JSON.stringify({
        message: 'DEAL price control skipped',
        process: 'deal-price-control',
        itemId: input.itemId,
        status: priceControl.status,
        updaterDisabled: priceControl.updaterDisabled ?? false,
        reason,
        ...extra,
      }),
    );

    return priceControl;
  }

  private resolveSkippedPriceControl(
    input: DealPriceControlEvaluateInput,
    reason: string,
  ): PromotionPriceControl {
    const existing = input.existingPriceControl;

    if (
      existing?.controlledBy === 'DEAL' &&
      (existing.updaterDisabled === true || existing.status === 'RELEASED')
    ) {
      return { ...existing, reason };
    }

    return {
      controlledBy: 'DEAL',
      status: 'SKIPPED',
      reason,
    };
  }
}
