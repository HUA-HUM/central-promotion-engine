import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';

export enum PromotionStatus {
  SYNCED = 'SYNCED',
  ACTIVE = 'ACTIVE',
  PAUSED = 'PAUSED',
  DELETED = 'DELETED',
  FAILED_SYNC = 'FAILED_SYNC',
  FAILED_ACTIVATION = 'FAILED_ACTIVATION',
  FAILED_DEACTIVATION = 'FAILED_DEACTIVATION',
}

export enum PromotionType {
  DEAL = 'DEAL',
  SMART = 'SMART',
  CUSTOM = 'CUSTOM',
  UNKNOWN = 'UNKNOWN',
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
  list?: number;

  @Prop()
  suggested?: number;

  @Prop()
  current?: number;

  @Prop()
  strikethrough?: number;
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
  minAllowedProfitability?: number;
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

@Schema({ collection: 'promotions', timestamps: true })
export class Promotion {
  @Prop({ required: true })
  promotionId!: string;

  @Prop({ required: true, index: true })
  itemId!: string;

  @Prop({ required: true, index: true })
  sellerId!: string;

  @Prop({ required: true, enum: PromotionType })
  type!: PromotionType;

  @Prop({ required: true, enum: PromotionStatus, index: true })
  status!: PromotionStatus;

  @Prop()
  offerId?: string;

  @Prop({ type: PromotionPrices, default: {} })
  prices!: PromotionPrices;

  @Prop({ type: PromotionEconomics, default: {} })
  economics!: PromotionEconomics;

  @Prop({ type: PromotionMetadata, default: {} })
  metadata!: PromotionMetadata;

  @Prop({ type: [PromotionAudit], default: [] })
  auditTrail!: PromotionAudit[];
}

export const PromotionSchema = SchemaFactory.createForClass(Promotion);
PromotionSchema.index({ promotionId: 1, itemId: 1 }, { unique: true });
