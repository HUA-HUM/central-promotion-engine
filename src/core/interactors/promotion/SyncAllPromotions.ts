import { AppConfig } from '@app/drivers/config/AppConfig';
import { CampaignMlaApiRepository } from '@core/adapters/repositories/ICampaignMlaApiRepository';
import { MercadolibreApiRepository } from '@core/adapters/repositories/IMercadolibreApiRepository';
import { PriceApiRepository } from '@core/adapters/repositories/IPriceApiRepository';
import { ProcessResult } from '@core/adapters/dto/ProcessResult';
import { Logger } from '@core/drivers/logger/Logger';
import { Promotion } from '@core/entities/Promotion';
import { PromotionCatalog, PromotionType } from '@core/entities/PromotionCatalog';
import { DealPromotionBuilder } from '@core/interactors/promotion/builders/DealPromotionBuilder';
import { PreNegotiatedPromotionBuilder } from '@core/interactors/promotion/builders/PreNegotiatedPromotionBuilder';
import {
  GenericPromotionBuilder,
  PromotionBuilder,
  PromotionBuilderInput,
} from '@core/interactors/promotion/builders/PromotionBuilder';
import { SmartPromotionBuilder } from '@core/interactors/promotion/builders/SmartPromotionBuilder';
import { SaveAllPromotion } from '@core/interactors/promotion/SaveAllPromotion';
import {
  PriceMetricsBulkResolver,
  PriceMetricsRequest,
} from '@core/interactors/promotion/services/PriceMetricsBulkResolver';

export interface SyncAllPromotionsInput {
  sourceProcess: string;
  updatedBy: string;
}

export interface SyncAllPromotionsBuilder {
  campaignMlaApiRepository: CampaignMlaApiRepository;
  mercadolibreApiRepository: MercadolibreApiRepository;
  priceApiRepository: PriceApiRepository;
  saveAllPromotion: SaveAllPromotion;
  config: AppConfig;
}

export class SyncAllPromotions {
  private readonly promotionBuilders = new Map<PromotionType, PromotionBuilder>();
  private genericPromotionBuilder?: GenericPromotionBuilder;
  private readonly priceMetricsResolver: PriceMetricsBulkResolver;

  constructor(private readonly builder: SyncAllPromotionsBuilder) {
    this.priceMetricsResolver = new PriceMetricsBulkResolver(builder.priceApiRepository);
  }

  private initializePromotionBuilders(): void {
    if (this.promotionBuilders.size > 0) {
      return;
    }

    const builders: PromotionBuilder[] = [
      new DealPromotionBuilder({ priceApiRepository: this.builder.priceApiRepository }),
      new SmartPromotionBuilder({ priceApiRepository: this.builder.priceApiRepository }),
      new PreNegotiatedPromotionBuilder({ priceApiRepository: this.builder.priceApiRepository }),
    ];

    this.genericPromotionBuilder = new GenericPromotionBuilder({
      priceApiRepository: this.builder.priceApiRepository,
    });

    for (const promotionBuilder of builders) {
      this.promotionBuilders.set(promotionBuilder.type, promotionBuilder);
    }
  }

  async execute(input: SyncAllPromotionsInput): Promise<ProcessResult> {
    const startedAt = new Date();

    Logger.info(
      JSON.stringify({
        message: 'Promotion sync process started',
        process: 'sync',
        sourceProcess: input.sourceProcess,
        updatedBy: input.updatedBy,
        startedAt: startedAt.toISOString(),
      }),
    );

    this.initializePromotionBuilders();

    const promotionCatalogs = (await this.builder.mercadolibreApiRepository.getPromotions())
      .filter((promotionCatalog) =>
        this.builder.config.syncPromotionTypes.includes(promotionCatalog.type),
      );
    const result = await this.syncPromotionCatalogs(promotionCatalogs, input, 'sync');

    const finishedAt = new Date();
    const durationMinutes = Number(
      ((finishedAt.getTime() - startedAt.getTime()) / 60000).toFixed(2),
    );

    Logger.info(
      JSON.stringify({
        message: 'Promotion sync process finished',
        process: result.process,
        sourceProcess: input.sourceProcess,
        updatedBy: input.updatedBy,
        startedAt: startedAt.toISOString(),
        finishedAt: finishedAt.toISOString(),
        durationMinutes,
        total: result.total,
        success: result.success,
        failure: result.failure,
        skipped: result.skipped,
      }),
    );

    return result;
  }

  async syncPromotionCatalogs(
    promotionCatalogs: PromotionCatalog[],
    input: SyncAllPromotionsInput,
    processName: string,
  ): Promise<ProcessResult> {
    this.initializePromotionBuilders();

    await this.builder.saveAllPromotion.saveCatalogs(promotionCatalogs);
    let success = 0;
    let failure = 0;

    for (const promotionCatalog of promotionCatalogs) {
      let searchAfter: string | undefined;

      do {
        const response = await this.builder.mercadolibreApiRepository.getElegibleItemsPaginated(
          promotionCatalog.promotionId,
          promotionCatalog.type,
          searchAfter,
        );

        const consolidated: Promotion[] = [];
        const eligibleItems = response.results ?? [];

        if (eligibleItems.length === 0) {
          searchAfter = response.paging?.searchAfter;
          continue;
        }

        const mlas = eligibleItems.map((item) => item.itemId);
        const existingMlasResponse = await this.builder.campaignMlaApiRepository.existsBulk(mlas);
        const existingMlas = new Set(
          (existingMlasResponse.items ?? [])
            .filter((item) => item.exists)
            .map((item) => item.mla),
        );

        const enabledEligibleItems = eligibleItems.filter((item) => existingMlas.has(item.itemId));
        const buildCommands: PromotionBuilderInput[] = [];
        for (const item of enabledEligibleItems) {
          try {
            const detail = await this.builder.mercadolibreApiRepository.getItemDetail(item.itemId);
            if (!detail.categoryId) {
              throw new Error(`Missing categoryId for item ${item.itemId}`);
            }

            buildCommands.push({
              promotionCatalog,
              eligibleItem: item,
              itemDetail: detail,
              input,
            });
          } catch (error) {
            failure += 1;
            const message = error instanceof Error ? error.message : 'Unknown sync error';
            Logger.error(
              JSON.stringify({
                message: 'Promotion sync item failed',
                process: processName,
                sourceProcess: input.sourceProcess,
                itemId: item.itemId,
                promotionId: promotionCatalog.promotionId,
                reason: message,
              }),
            );
          }
        }

        const metricsRequests: PriceMetricsRequest<PromotionBuilderInput>[] = buildCommands.map(
          (command) => ({
            context: command,
            input: {
              itemId: command.eligibleItem.itemId,
              sku: command.itemDetail.sku,
              categoryId: command.itemDetail.categoryId,
              publicationType: command.itemDetail.listingTypeId,
              salePrice: command.eligibleItem.suggestedPrice ?? command.itemDetail.price ?? 0,
              meliContributionPercentage: command.eligibleItem.meliPercentage,
            },
          }),
        );

        const resolvedMetrics = await this.priceMetricsResolver.resolve(metricsRequests);

        for (const resolved of resolvedMetrics) {
          try {
            if (resolved.error) {
              throw resolved.error;
            }

            const promotion = await this.buildPromotion({
              ...resolved.context,
              priceMetrics: resolved.metrics,
            });
            consolidated.push(promotion);
          } catch (error) {
            failure += 1;
            const message = error instanceof Error ? error.message : 'Unknown sync error';
            Logger.error(
              JSON.stringify({
                message: 'Promotion sync item failed',
                process: processName,
                sourceProcess: input.sourceProcess,
                itemId: resolved.context.eligibleItem.itemId,
                promotionId: promotionCatalog.promotionId,
                reason: message,
              }),
            );
          }
        }

        if (consolidated.length > 0) {
          await this.builder.saveAllPromotion.saveAll(consolidated);
          success += consolidated.length;
        }

        console.log(`Processed promotion ${promotionCatalog.promotionId} page, success: ${success}, failure: ${failure}`);

        searchAfter = response.paging?.searchAfter;
      } while (searchAfter);
    }

    return {
      process: processName,
      total: success + failure,
      success,
      failure,
      skipped: 0,
    };
  }

  private async buildPromotion(command: PromotionBuilderInput): Promise<Promotion> {
    const promotionBuilder =
      this.promotionBuilders.get(command.promotionCatalog.type) ?? this.genericPromotionBuilder;

    if (!promotionBuilder) {
      throw new Error('No generic promotion builder configured');
    }

    return promotionBuilder.build(command);
  }
}
