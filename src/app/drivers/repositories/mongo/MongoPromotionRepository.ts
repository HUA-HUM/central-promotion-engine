import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model, Types } from 'mongoose';
import { AppConfigService } from '@app/drivers/config/AppConfigService';
import { Logger } from '@core/drivers/logger/Logger';
import { Promotion, PromotionStatus } from '@core/entities/Promotion';
import {
  PaginatedPromotionCatalogsResult,
  PaginatedPromotionsResult,
  PromotionCatalogFilters,
  PromotionFilters,
  PromotionRepository,
  PromotionStatsResult,
  PromotionStatusBreakdown,
} from '@core/adapters/repositories/IPromotionRepository';
import { PromotionCatalog, PromotionType } from '@core/entities/PromotionCatalog';

@Injectable()
export class MongoPromotionRepository implements PromotionRepository {
  private readonly metricsLoggingEnabled: boolean;

  constructor(
    @InjectModel(Promotion.name)
    private readonly promotionModel: Model<Promotion>,
    @InjectModel(PromotionCatalog.name)
    private readonly promotionCatalogModel: Model<PromotionCatalog>,
    configService: AppConfigService,
  ) {
    this.metricsLoggingEnabled = configService.get().metricsLoggingEnabled;
  }

  private async measure<T>(
    operation: string,
    fn: () => Promise<T>,
    metadata: Record<string, unknown> = {},
  ): Promise<T> {
    const startedAt = Date.now();

    try {
      const result = await fn();
      if (this.metricsLoggingEnabled) {
        Logger.info(
          JSON.stringify({
            message: 'Mongo operation succeeded',
            service: 'MONGO',
            operation,
            durationMs: Date.now() - startedAt,
            resultCount: Array.isArray(result) ? result.length : undefined,
            ...metadata,
          }),
        );
      }
      return result;
    } catch (error) {
      Logger.error(
        JSON.stringify({
          message: 'Mongo operation failed',
          service: 'MONGO',
          operation,
          durationMs: Date.now() - startedAt,
          reason: error instanceof Error ? error.message : 'Unknown mongo error',
          ...metadata,
        }),
      );
      throw error;
    }
  }

  async saveAll(promotions: Promotion[]): Promise<void> {
    if (promotions.length === 0) {
      return;
    }

    await this.measure(
      'saveAll',
      () =>
        this.promotionModel.bulkWrite(
          promotions.map((promotion) => this.buildPromotionUpsertOperation(promotion)),
          { ordered: false },
        ),
      { itemCount: promotions.length },
    );
  }

  private buildPromotionUpsertOperation(promotion: Promotion) {
    const {
      auditTrail: incomingAuditTrail = [],
      status: incomingStatus,
      ...fieldsToSet
    } = promotion;

    // If a promotion is already ACTIVE in DB, keep it ACTIVE during sync updates.
    const resolvedStatus = {
      $cond: [
        { $eq: ['$status', PromotionStatus.ACTIVE] },
        '$status',
        incomingStatus,
      ],
    };

    return {
      updateOne: {
        filter: {
          promotionId: promotion.promotionId,
          itemId: promotion.itemId,
        },
        update: [
          {
            $set: fieldsToSet,
          },
          {
            $set: {
              status: resolvedStatus,
            },
          },
          {
            $set: {
              auditTrail: {
                $concatArrays: [
                  { $ifNull: ['$auditTrail', []] },
                  incomingAuditTrail,
                ],
              },
            },
          },
        ],
        upsert: true,
      },
    };
  }

  async saveCatalogs(catalogs: PromotionCatalog[]): Promise<void> {
    if (catalogs.length === 0) {
      return;
    }

    await this.measure(
      'saveCatalogs',
      () =>
        this.promotionCatalogModel.bulkWrite(
          catalogs.map((catalog) => ({
            updateOne: {
              filter: { promotionId: catalog.promotionId },
              update: { $set: catalog },
              upsert: true,
            },
          })),
          { ordered: false },
        ),
      { itemCount: catalogs.length },
    );
  }

  async findPendingActivation(): Promise<Promotion[]> {
    return this.promotionModel
      .find({
        status: {
          $in: [PromotionStatus.SYNCED, PromotionStatus.FAILED_ACTIVATION],
        },
      })
      .lean<Promotion[]>()
      .exec();
  }

  async findPendingActivationBatch(afterId?: string, limit = 500): Promise<Promotion[]> {
    const query: FilterQuery<Promotion> = {
      status: {
        $in: [PromotionStatus.SYNCED, PromotionStatus.FAILED_ACTIVATION],
      },
    };

    if (afterId) {
      query._id = { $gt: new Types.ObjectId(afterId) };
    }

    return this.measure('findPendingActivationBatch', () =>
      this.promotionModel
        .find(query)
        .sort({ _id: 1 })
        .limit(limit)
        .lean<Promotion[]>()
        .exec(),
    );
  }

  async findActive(): Promise<Promotion[]> {
    return this.promotionModel
      .find({
        status: PromotionStatus.ACTIVE,
      })
      .lean<Promotion[]>()
      .exec();
  }

  async findActiveBatch(afterId?: string, limit = 500): Promise<Promotion[]> {
    const query: FilterQuery<Promotion> = {
      status: PromotionStatus.ACTIVE,
    };

    if (afterId) {
      query._id = { $gt: new Types.ObjectId(afterId) };
    }

    return this.measure('findActiveBatch', () =>
      this.promotionModel
        .find(query)
        .sort({ _id: 1 })
        .limit(limit)
        .lean<Promotion[]>()
        .exec(),
    );
  }

  async findFailedDeactivationBatch(afterId?: string, limit = 500): Promise<Promotion[]> {
    const query: FilterQuery<Promotion> = {
      status: PromotionStatus.FAILED_DEACTIVATION,
    };

    if (afterId) {
      query._id = { $gt: new Types.ObjectId(afterId) };
    }

    return this.measure('findFailedDeactivationBatch', () =>
      this.promotionModel
        .find(query)
        .sort({ _id: 1 })
        .limit(limit)
        .lean<Promotion[]>()
        .exec(),
    );
  }

  async findItemIdsWithActivePromotion(
    itemIds: string[],
    type: PromotionType,
    excludingPromotionId?: string,
  ): Promise<Set<string>> {
    if (itemIds.length === 0) {
      return new Set();
    }

    const query: FilterQuery<Promotion> = {
      itemId: { $in: itemIds },
      type,
      status: PromotionStatus.ACTIVE,
    };

    if (excludingPromotionId) {
      query.promotionId = { $ne: excludingPromotionId };
    }

    const activePromotions = await this.measure(
      'findItemIdsWithActivePromotion',
      () =>
        this.promotionModel
          .find(query, { itemId: 1 })
          .lean<Pick<Promotion, 'itemId'>[]>()
          .exec(),
      { itemCount: itemIds.length },
    );

    return new Set(activePromotions.map((promotion) => promotion.itemId));
  }

  async findByItemIds(promotionId: string, itemIds: string[]): Promise<Promotion[]> {
    if (itemIds.length === 0) {
      return [];
    }

    return this.measure(
      'findByItemIds',
      () =>
        this.promotionModel
          .find({ promotionId, itemId: { $in: itemIds } })
          .lean<Promotion[]>()
          .exec(),
      { itemCount: itemIds.length },
    );
  }

  async findByPromotionId(promotionId: string): Promise<Promotion[]> {
    return this.promotionModel
      .find({ promotionId })
      .lean<Promotion[]>()
      .exec();
  }

  /**
   * Same rows as `findByPromotionId`, paginated by `_id` (same cursor style as
   * `findPendingActivationBatch`/`findActiveBatch`). A DEAL promotion can have hundreds of
   * thousands of synced items — `findByPromotionId` loading them all into one array is what
   * blows up the process; callers that need to walk every item should page through this instead.
   */
  async findByPromotionIdBatch(promotionId: string, afterId?: string, limit = 500): Promise<Promotion[]> {
    const query: FilterQuery<Promotion> = { promotionId };

    if (afterId) {
      query._id = { $gt: new Types.ObjectId(afterId) };
    }

    return this.measure('findByPromotionIdBatch', () =>
      this.promotionModel
        .find(query)
        .sort({ _id: 1 })
        .limit(limit)
        .lean<Promotion[]>()
        .exec(),
    );
  }

  async update(promotion: Promotion): Promise<void> {
    const { auditTrail, ...promotionWithoutAuditTrail } = promotion;
    const latestAudit = auditTrail?.[auditTrail.length - 1];

    await this.measure(
      'update',
      () =>
        this.promotionModel.updateOne(
          {
            promotionId: promotion.promotionId,
            itemId: promotion.itemId,
          },
          {
            $set: promotionWithoutAuditTrail,
            ...(latestAudit
              ? {
                  $push: {
                    auditTrail: latestAudit,
                  },
                }
              : {}),
          },
        ),
      { promotionId: promotion.promotionId, itemId: promotion.itemId },
    );
  }

  async findAll(filters: PromotionFilters): Promise<PaginatedPromotionsResult> {
    const query: FilterQuery<Promotion> = {};
    const page = filters.page ?? 1;
    const limit = filters.limit ?? 100;

    if (filters.status) {
      query.status = filters.status;
    }

    if (filters.statuses?.length) {
      query.status = {
        $in: filters.statuses,
      };
    }

    if (filters.itemId) {
      query.itemId = filters.itemId;
    }

    const [items, total] = await Promise.all([
      this.promotionModel
      .find(query)
      .sort({ updatedAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean<Promotion[]>()
      .exec(),
      this.promotionModel.countDocuments(query).exec(),
    ]);

    return {
      items,
      total,
      page,
      limit,
      totalPages: total === 0 ? 0 : Math.ceil(total / limit),
    };
  }

  async findCatalogs(filters: PromotionCatalogFilters): Promise<PaginatedPromotionCatalogsResult> {
    const query: FilterQuery<PromotionCatalog> = {};
    const page = filters.page ?? 1;
    const limit = filters.limit ?? 100;

    if (filters.status) {
      query.status = filters.status;
    }

    if (filters.type) {
      query.type = filters.type;
    }

    if (filters.promotionId) {
      query.promotionId = filters.promotionId;
    }

    if (filters.name) {
      query.name = {
        $regex: filters.name,
        $options: 'i',
      };
    }

    const [items, total] = await Promise.all([
      this.promotionCatalogModel
        .find(query)
        .sort({ updatedAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean<PromotionCatalog[]>()
        .exec(),
      this.promotionCatalogModel.countDocuments(query).exec(),
    ]);

    return {
      items,
      total,
      page,
      limit,
      totalPages: total === 0 ? 0 : Math.ceil(total / limit),
    };
  }

  async getStats(): Promise<PromotionStatsResult> {
    const rows = await this.promotionModel.aggregate<{
      _id: {
        type: PromotionType;
        status: PromotionStatus;
      };
      count: number;
    }>([
      {
        $group: {
          _id: {
            type: '$type',
            status: '$status',
          },
          count: {
            $sum: 1,
          },
        },
      },
    ]).exec();

    const smart = this.createEmptyBreakdown();
    const deal = this.createEmptyBreakdown();
    const preNegotiated = this.createEmptyBreakdown();

    for (const row of rows) {
      const bucket = this.resolveBucket(row._id.type, {
        smart,
        deal,
        preNegotiated,
      });

      if (!bucket) {
        continue;
      }

      bucket.total += row.count;

      if (row._id.status === PromotionStatus.PENDING) {
        bucket.pending += row.count;
      }

      if (row._id.status === PromotionStatus.ACTIVE) {
        bucket.active += row.count;
      }

      if (row._id.status === PromotionStatus.PAUSED) {
        bucket.paused += row.count;
      }

      if (row._id.status === PromotionStatus.SYNCED) {
        bucket.synced += row.count;
      }

      if (row._id.status === PromotionStatus.DELETED) {
        bucket.deleted += row.count;
      }

      if (row._id.status === PromotionStatus.FINISHED) {
        bucket.finished += row.count;
      }

      if (row._id.status === PromotionStatus.FAILED_SYNC) {
        bucket.failedSync += row.count;
      }

      if (row._id.status === PromotionStatus.FAILED_ACTIVATION) {
        bucket.failedActivation += row.count;
      }

      if (row._id.status === PromotionStatus.FAILED_DEACTIVATION) {
        bucket.failedDeactivation += row.count;
      }
    }

    return {
      total: smart.total + deal.total + preNegotiated.total,
      smart,
      deal,
      preNegotiated,
    };
  }

  private createEmptyBreakdown(): PromotionStatusBreakdown {
    return {
      total: 0,
      pending: 0,
      active: 0,
      paused: 0,
      synced: 0,
      deleted: 0,
      finished: 0,
      failedSync: 0,
      failedActivation: 0,
      failedDeactivation: 0,
    };
  }

  private resolveBucket(
    type: PromotionType,
    buckets: {
      smart: PromotionStatusBreakdown;
      deal: PromotionStatusBreakdown;
      preNegotiated: PromotionStatusBreakdown;
    },
  ): PromotionStatusBreakdown | null {
    if (type === PromotionType.SMART) {
      return buckets.smart;
    }

    if (type === PromotionType.DEAL) {
      return buckets.deal;
    }

    if (type === PromotionType.PRE_NEGOTIATED) {
      return buckets.preNegotiated;
    }

    return null;
  }
}
