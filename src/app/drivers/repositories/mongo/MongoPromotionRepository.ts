import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model, Types } from 'mongoose';
import { Promotion, PromotionStatus } from '@core/entities/Promotion';
import {
  PaginatedPromotionsResult,
  PromotionFilters,
  PromotionRepository,
} from '@core/adapters/repositories/IPromotionRepository';
import { PromotionCatalog } from '@core/entities/PromotionCatalog';

@Injectable()
export class MongoPromotionRepository implements PromotionRepository {
  constructor(
    @InjectModel(Promotion.name)
    private readonly promotionModel: Model<Promotion>,
    @InjectModel(PromotionCatalog.name)
    private readonly promotionCatalogModel: Model<PromotionCatalog>,
  ) {}

  async saveAll(promotions: Promotion[]): Promise<void> {
    if (promotions.length === 0) {
      return;
    }

    await this.promotionModel.bulkWrite(
      promotions.map((promotion) => this.buildPromotionUpsertOperation(promotion)),
      { ordered: false },
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

    await this.promotionCatalogModel.bulkWrite(
      catalogs.map((catalog) => ({
        updateOne: {
          filter: { promotionId: catalog.promotionId },
          update: { $set: catalog },
          upsert: true,
        },
      })),
      { ordered: false },
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

    return this.promotionModel
      .find(query)
      .sort({ _id: 1 })
      .limit(limit)
      .lean<Promotion[]>()
      .exec();
  }

  async findActive(): Promise<Promotion[]> {
    return this.promotionModel
      .find({
        status: PromotionStatus.ACTIVE,
      })
      .lean<Promotion[]>()
      .exec();
  }

  async update(promotion: Promotion): Promise<void> {
    const { auditTrail, ...promotionWithoutAuditTrail } = promotion;
    const latestAudit = auditTrail?.[auditTrail.length - 1];

    await this.promotionModel.updateOne(
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
}
