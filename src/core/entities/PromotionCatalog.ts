import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { PromotionStatus, PromotionType } from '@core/entities/Promotion';

@Schema({ collection: 'promotionCatalogs', timestamps: true })
export class PromotionCatalog {
  @Prop({ required: true, unique: true, index: true })
  promotionId!: string;

  @Prop({ enum: PromotionType })
  type!: PromotionType;

  @Prop({ enum: PromotionStatus, index: true })
  status!: PromotionStatus;

  @Prop()
  name?: string;

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
PromotionCatalogSchema.index({ promotionId: 1 }, { unique: true });