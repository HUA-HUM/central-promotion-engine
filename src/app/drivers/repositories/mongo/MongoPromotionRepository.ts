import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model } from 'mongoose';
import { Promotion, PromotionStatus } from '@core/entities/Promotion';
import {
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
      promotions.map((promotion) => {
        const { auditTrail, ...promotionWithoutAuditTrail } = promotion;

        return {
          updateOne: {
            filter: {
              promotionId: promotion.promotionId,
              itemId: promotion.itemId,
            },
            update: [
              {
                $set: promotionWithoutAuditTrail,
              },
              {
                $set: {
                  auditTrail: {
                    $concatArrays: [
                      { $ifNull: ['$auditTrail', []] },
                      auditTrail ?? [],
                    ],
                  },
                },
              },
            ],
            upsert: true,
          },
        };
      }),
      { ordered: false },
    );
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

  async findAll(filters: PromotionFilters): Promise<Promotion[]> {
    const query: FilterQuery<Promotion> = {};

    if (filters.status) {
      query.status = filters.status;
    }

    if (filters.itemId) {
      query.itemId = filters.itemId;
    }

    return this.promotionModel
      .find(query)
      .sort({ updatedAt: -1 })
      .limit(filters.limit ?? 100)
      .lean<Promotion[]>()
      .exec();
  }
}
