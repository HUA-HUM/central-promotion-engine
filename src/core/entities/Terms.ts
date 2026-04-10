import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';

@Schema({ _id: false })
export class TermsRatio {
  @Prop()
  percentage?: number;

  @Prop()
  amount?: number;
}

@Schema({ _id: false })
export class TermsValue {
  @Prop()
  price?: number;

  @Prop()
  profit?: number;
}

@Schema({ _id: false })
export class TermsResignation {
  @Prop()
  total?: number;

  @Prop({ type: TermsRatio, default: {} })
  mercadolibre?: TermsRatio;

  @Prop({ type: TermsRatio, default: {} })
  seller?: TermsRatio;
}

@Schema({ _id: false })
export class TermsPvp {
  @Prop({ type: TermsValue, default: {} })
  current?: TermsValue;

  @Prop({ type: TermsValue, default: {} })
  revenue?: TermsValue;

  @Prop({ type: TermsValue, default: {} })
  store?: TermsValue;
}

@Schema({ _id: false })
export class Terms {
  @Prop({ type: TermsResignation, default: {} })
  resignation!: TermsResignation;

  @Prop({ type: TermsPvp, default: {} })
  pvp!: TermsPvp;
}

export const TermsSchema = SchemaFactory.createForClass(Terms);
