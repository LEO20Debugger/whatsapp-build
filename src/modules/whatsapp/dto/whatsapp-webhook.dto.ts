import {
  IsString,
  IsNotEmpty,
  IsArray,
  ValidateNested,
  IsOptional,
  IsNumber,
} from "class-validator";
import { Type } from "class-transformer";

export class WhatsAppContactDto {
  @IsString()
  @IsNotEmpty()
  profile: {
    name: string;
  };

  @IsString()
  @IsNotEmpty()
  wa_id: string;
}

export class WhatsAppTextDto {
  @IsString()
  @IsNotEmpty()
  body: string;
}

export class WhatsAppMessageDto {
  @IsString()
  @IsNotEmpty()
  from: string;

  @IsString()
  @IsNotEmpty()
  id: string;

  @IsNumber()
  timestamp: number;

  @ValidateNested()
  @Type(() => WhatsAppTextDto)
  @IsOptional()
  text?: WhatsAppTextDto;

  @IsString()
  @IsOptional()
  type?: string;
}

export class WhatsAppValueDto {
  @IsString()
  @IsNotEmpty()
  messaging_product: string;

  @ValidateNested({ each: true })
  @Type(() => WhatsAppContactDto)
  @IsArray()
  @IsOptional()
  contacts?: WhatsAppContactDto[];

  @ValidateNested({ each: true })
  @Type(() => WhatsAppMessageDto)
  @IsArray()
  @IsOptional()
  messages?: WhatsAppMessageDto[];

  @IsString()
  @IsOptional()
  metadata?: {
    display_phone_number: string;
    phone_number_id: string;
  };
}

export class WhatsAppChangeDto {
  @ValidateNested()
  @Type(() => WhatsAppValueDto)
  value: WhatsAppValueDto;

  @IsString()
  @IsNotEmpty()
  field: string;
}

export class WhatsAppEntryDto {
  @IsString()
  @IsNotEmpty()
  id: string;

  @ValidateNested({ each: true })
  @Type(() => WhatsAppChangeDto)
  @IsArray()
  changes: WhatsAppChangeDto[];
}

export class WhatsAppWebhookDto {
  @IsString()
  @IsNotEmpty()
  object: string;

  @ValidateNested({ each: true })
  @Type(() => WhatsAppEntryDto)
  @IsArray()
  entry: WhatsAppEntryDto[];
}
