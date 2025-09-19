import {
  IsString,
  IsNotEmpty,
  IsOptional,
  ValidateNested,
  IsArray,
} from "class-validator";
import { Type } from "class-transformer";

export class TextMessageDto {
  @IsString()
  @IsNotEmpty()
  body: string;

  @IsOptional()
  @IsString()
  preview_url?: boolean;
}

export class TemplateParameterDto {
  @IsString()
  @IsNotEmpty()
  type: "text";

  @IsString()
  @IsNotEmpty()
  text: string;
}

export class TemplateComponentDto {
  @IsString()
  @IsNotEmpty()
  type: "header" | "body" | "button";

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TemplateParameterDto)
  @IsOptional()
  parameters?: TemplateParameterDto[];
}

export class TemplateDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  @IsNotEmpty()
  language: {
    code: string;
  };

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TemplateComponentDto)
  @IsOptional()
  components?: TemplateComponentDto[];
}

export class OutgoingMessageDto {
  @IsString()
  @IsNotEmpty()
  messaging_product: string;

  @IsString()
  @IsNotEmpty()
  to: string;

  @IsString()
  @IsNotEmpty()
  type: "text" | "template";

  @ValidateNested()
  @Type(() => TextMessageDto)
  @IsOptional()
  text?: TextMessageDto;

  @ValidateNested()
  @Type(() => TemplateDto)
  @IsOptional()
  template?: TemplateDto;
}
