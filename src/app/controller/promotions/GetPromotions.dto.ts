import { IsOptional, IsString } from 'class-validator';
import { PromotionStatus } from '@core/entities/Promotion';

export class GetPromotionsDto {
  @IsOptional()
  @IsString()
  status?: PromotionStatus;

  @IsOptional()
  @IsString()
  sellerId?: string;

  @IsOptional()
  @IsString()
  itemId?: string;
}
