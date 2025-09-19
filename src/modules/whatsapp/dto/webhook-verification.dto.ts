import { IsString, IsNotEmpty } from "class-validator";

export class WebhookVerificationDto {
  @IsString()
  @IsNotEmpty()
  "hub.mode": string;

  @IsString()
  @IsNotEmpty()
  "hub.challenge": string;

  @IsString()
  @IsNotEmpty()
  "hub.verify_token": string;
}
