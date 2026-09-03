import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { PromotionType } from '@core/entities/PromotionCatalog';
import { Terms } from '@core/entities/Terms';

export enum PromotionStatus {
  PENDING = 'PENDING',
  SYNCED = 'SYNCED',
  ACTIVE = 'ACTIVE',
  PAUSED = 'PAUSED',
  DELETED = 'DELETED',
  FINISHED = 'FINISHED',
  FAILED_SYNC = 'FAILED_SYNC',
  FAILED_ACTIVATION = 'FAILED_ACTIVATION',
  FAILED_DEACTIVATION = 'FAILED_DEACTIVATION',
}

@Schema({ _id: false })
export class PromotionAudit {
  @Prop({ required: true })
  process!: string;

  @Prop({ required: true, enum: PromotionStatus })
  status!: PromotionStatus;

  @Prop()
  reason?: string;

  @Prop({ required: true })
  executedAt!: Date;
}

@Schema({ _id: false })
export class PromotionPrices {
  @Prop()
  originalPrice?: number;

  @Prop()
  minPrice?: number;

  @Prop()
  maxPrice?: number;

  @Prop()
  suggestedPrice?: number;
}

@Schema({ _id: false })
export class PromotionEconomics {
  @Prop()
  cost?: number;

  @Prop()
  profit?: number;

  @Prop()
  profitability?: number;

  @Prop()
  margin?: number;

  @Prop()
  profitable?: boolean;

  @Prop()
  shouldPause?: boolean;
}

@Schema({ _id: false })
export class PromotionMetadata {
  @Prop()
  syncedAt?: Date;

  @Prop()
  activatedAt?: Date;

  @Prop()
  deactivatedAt?: Date;

  @Prop()
  updatedBy?: string;

  @Prop()
  sourceProcess?: string;

  @Prop()
  reason?: string;

  @Prop()
  statusReason?: string;
}

export type PriceControlStatus =
  | 'PRICE_UPDATED_PENDING_SYNC'
  | 'ACTIVE'
  | 'RELEASED'
  | 'SKIPPED'
  /** Base price bumped, ML applied it, DEAL is now profitable — nothing more to do. */
  | 'SETTLED'
  /** Gave up: ML never applied the bump, or it stayed unprofitable after repeated bumps. */
  | 'EXHAUSTED';

@Schema({ _id: false })
export class PromotionPriceControl {
  @Prop({ required: true })
  controlledBy!: 'DEAL';

  @Prop({
    required: true,
    enum: ['PRICE_UPDATED_PENDING_SYNC', 'ACTIVE', 'RELEASED', 'SKIPPED', 'SETTLED', 'EXHAUSTED'],
  })
  status!: PriceControlStatus;

  @Prop()
  updaterDisabled?: boolean;

  @Prop()
  disabledAt?: Date;

  @Prop()
  releasedAt?: Date;

  @Prop()
  basePriceBeforeControl?: number;

  @Prop()
  currentBasePrice?: number;

  @Prop()
  lastCalculatedDiscountedPrice?: number;

  @Prop()
  lastPriceUpdateAt?: Date;

  /** max_discounted_price observed before the first DEAL price bump — anchor for measuring ML recompose. */
  @Prop()
  originalMaxDiscountedPrice?: number;

  /** How many times this DEAL has pushed a new base price to Mercado Libre. */
  @Prop()
  bumpCount?: number;

  @Prop()
  firstBumpAt?: Date;

  @Prop()
  reason?: string;
}

@Schema({ collection: 'promotions', timestamps: true })
export class Promotion {
  @Prop({ required: true })
  itemId!: string;

  @Prop({ required: true })
  promotionId!: string;

  @Prop({ required: true })
  name!: string;

  @Prop({ required: true, enum: PromotionType })
  type!: PromotionType;
  
  @Prop({ required: true, enum: PromotionStatus })
  status!: PromotionStatus;

  @Prop()
  offerId?: string;

  @Prop()
  startDate?: Date;

  @Prop()
  finishDate?: Date;

  @Prop()
  deadlineDate?: Date;

  @Prop({ required: true })
  sku!: string;

  @Prop({ required: true })
  listingTypeId!: string;

  @Prop({ required: true })
  categoryId!: string;

  @Prop({ type: PromotionPrices, default: {} })
  prices!: PromotionPrices;

  @Prop({ type: PromotionEconomics, default: {} })
  economics!: PromotionEconomics;

  @Prop({ type: PromotionMetadata, default: {} })
  metadata!: PromotionMetadata;

  @Prop({ type: [PromotionAudit], default: [] })
  auditTrail!: PromotionAudit[];

  @Prop({ type: Terms, default: {} })
  terms?: Terms;

  @Prop({ type: PromotionPriceControl })
  priceControl?: PromotionPriceControl;
}

export const PromotionSchema = SchemaFactory.createForClass(Promotion);

PromotionSchema.index({ promotionId: 1, itemId: 1 });
