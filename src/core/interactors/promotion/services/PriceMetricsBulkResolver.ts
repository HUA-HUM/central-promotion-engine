import {
  IAPIPriceApiRepository,
  PriceMetrics,
  PriceMetricsInput,
} from '@core/adapters/repositories/price-api/IAPIPriceApiRepository';
import { Logger } from '@core/drivers/logger/Logger';

export interface PriceMetricsRequest<TContext> {
  context: TContext;
  input: PriceMetricsInput;
}

export interface PriceMetricsResolvedRequest<TContext> {
  context: TContext;
  input: PriceMetricsInput;
  metrics?: PriceMetrics;
  error?: Error;
}

export const buildPriceMetricsKey = (input: Pick<PriceMetricsInput, 'itemId' | 'sku'>): string =>
  [input.itemId, input.sku ?? ''].join('|');

export interface PriceMetricsResolveStats {
  totalRequests: number;
  bulkCallCount: number;
  bulkMatchedCount: number;
  individualFallbackCount: number;
}

export interface PriceMetricsResolveResult<TContext> {
  results: PriceMetricsResolvedRequest<TContext>[];
  stats: PriceMetricsResolveStats;
}

export class PriceMetricsBulkResolver {
  private static readonly BULK_BATCH_SIZE = 50;

  constructor(private readonly priceApiRepository: IAPIPriceApiRepository) {}

  async resolve<TContext>(
    requests: PriceMetricsRequest<TContext>[],
  ): Promise<PriceMetricsResolveResult<TContext>> {
    if (requests.length === 0) {
      return {
        results: [],
        stats: { totalRequests: 0, bulkCallCount: 0, bulkMatchedCount: 0, individualFallbackCount: 0 },
      };
    }

    const bulkMetricsByKey = new Map<string, PriceMetrics>();

    const requestChunks = this.chunkArray(requests, PriceMetricsBulkResolver.BULK_BATCH_SIZE);
    let bulkCallCount = 0;

    for (const chunk of requestChunks) {
      bulkCallCount += 1;
      try {
        const bulkResponse = await this.priceApiRepository.getMetricsBulk(
          chunk.map((request) => request.input),
        );

        for (const result of bulkResponse) {
          bulkMetricsByKey.set(buildPriceMetricsKey(result.input), result.metrics);
        }
      } catch (error) {
        Logger.error(
          JSON.stringify({
            message: 'Price metrics bulk chunk failed, falling back to individual requests',
            process: 'sync',
            chunkRequestCount: chunk.length,
            reason: error instanceof Error ? error.message : 'Unknown price metrics bulk error',
          }),
        );
      }
    }

    const resolved: PriceMetricsResolvedRequest<TContext>[] = [];
    let bulkMatchedCount = 0;
    let individualFallbackCount = 0;

    for (const request of requests) {
      const key = buildPriceMetricsKey(request.input);
      const bulkMetrics = bulkMetricsByKey.get(key);

      if (bulkMetrics) {
        bulkMatchedCount += 1;
        resolved.push({
          context: request.context,
          input: request.input,
          metrics: bulkMetrics,
        });
        continue;
      }

      individualFallbackCount += 1;

      try {
        const metrics = await this.priceApiRepository.getMetrics(request.input);
        resolved.push({
          context: request.context,
          input: request.input,
          metrics,
        });
      } catch (error) {
        resolved.push({
          context: request.context,
          input: request.input,
          error: error instanceof Error ? error : new Error('Unknown metrics error'),
        });
      }
    }

    const stats: PriceMetricsResolveStats = {
      totalRequests: requests.length,
      bulkCallCount,
      bulkMatchedCount,
      individualFallbackCount,
    };

    return { results: resolved, stats };
  }

  private chunkArray<T>(items: T[], size: number): T[][] {
    const chunks: T[][] = [];

    for (let index = 0; index < items.length; index += size) {
      chunks.push(items.slice(index, index + size));
    }

    return chunks;
  }
}
