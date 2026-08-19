import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsOptional, IsString } from 'class-validator';

export class ActivateDealPromotionDto {
  @ApiProperty()
  @IsString()
  promotionId!: string;

  @ApiPropertyOptional({
    type: [String],
    nullable: true,
    description:
      'MLAs to activate. Omit or send null to activate every synced item of the promotion. An empty array activates nothing.',
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  mlas?: string[] | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  updatedBy?: string;
}
