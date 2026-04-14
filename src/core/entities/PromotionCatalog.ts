import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';

export enum PromotionCatalogStatus {
  PENDING = 'pending',
  STARTED = 'started',
  FINISHED = 'finished',
}

export enum PromotionType {
  DEAL = 'DEAL',
  SMART = 'SMART',
  PRE_NEGOTIATED = 'PRE_NEGOTIATED',
  UNKNOWN = 'UNKNOWN',
}

@Schema({ collection: 'promotionCatalogs', timestamps: true })
export class PromotionCatalog {
  @Prop({ required: true, unique: true, index: true })
  promotionId!: string;

  @Prop({ enum: PromotionType, required: true })
  type!: PromotionType;

  @Prop({ enum: PromotionCatalogStatus, index: true })
  status!: PromotionCatalogStatus;

  @Prop({ required: true })
  name!: string;

  @Prop()
  subType?: string;

  @Prop()
  fixedAmount?: number;

  @Prop()
  minPurchaseAmount?: number;

  @Prop()
  startDate?: Date;

  @Prop()
  finishDate?: Date;

  @Prop()
  deadlineDate?: Date;
}

export const PromotionCatalogSchema = SchemaFactory.createForClass(PromotionCatalog);