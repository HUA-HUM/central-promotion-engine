import { IsOptional, IsString } from 'class-validator';

export class RunProcessDto {
  @IsOptional()
  @IsString()
  updatedBy?: string;
}
