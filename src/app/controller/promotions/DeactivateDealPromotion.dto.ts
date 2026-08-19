import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsOptional, IsString } from 'class-validator';

export class DeactivateDealPromotionDto {
  @ApiProperty()
  @IsString()
  promotionId!: string;

  @ApiPropertyOptional({
    type: [String],
    nullable: true,
    description:
      'MLAs to deactivate. Omit or send null to deactivate every synced item of the promotion. An empty array deactivates nothing.',
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
