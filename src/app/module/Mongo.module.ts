import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { MongoPromotionRepository } from '@app/drivers/repositories/mongo/MongoPromotionRepository';
import { Promotion, PromotionSchema } from '@core/entities/Promotion';
import { PromotionCatalog, PromotionCatalogSchema } from '@core/entities/PromotionCatalog';

const repositories = [MongoPromotionRepository];

@Module({
  imports: [
    MongooseModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        uri: configService.get<string>('MONGO_URL'),
        maxPoolSize: 10,
        serverSelectionTimeoutMS: 5000,
        socketTimeoutMS: 45000,
        retryWrites: true,
        retryReads: true,
      }),
    }),
    MongooseModule.forFeature([
      { name: Promotion.name, schema: PromotionSchema },
      { name: PromotionCatalog.name, schema: PromotionCatalogSchema },
    ]),
  ],
  providers: repositories,
  exports: [MongooseModule, ...repositories],
})
export class MongoModule {}
