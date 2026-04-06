import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { MongoModule } from '@app/module/Mongo.module';
import { PromotionModule } from '@app/module/promotion/Promotion.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env'],
    }),
    ScheduleModule.forRoot(),
    MongoModule,
    PromotionModule,
  ],
})
export class AppModule {}
