import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { MongoPromotionRepository } from '@app/drivers/repositories/mongo/MongoPromotionRepository';
import { Promotion, PromotionSchema } from '@core/entities/Promotion';

const repositories = [MongoPromotionRepository];

@Module({
  imports: [
    MongooseModule.forRoot(process.env.MONGO_URL as string, {
      maxPoolSize: 10,
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
      retryWrites: true,
      retryReads: true,
    }),
    MongooseModule.forFeature([{ name: Promotion.name, schema: PromotionSchema }]),
  ],
  providers: repositories,
  exports: [MongooseModule, ...repositories],
})
export class MongoModule {}
