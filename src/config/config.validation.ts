import * as Joi from "joi";

export const configValidation = Joi.object({
  NODE_ENV: Joi.string()
    .valid("development", "production", "test")
    .default("development"),
  PORT: Joi.number().default(4000),

  // Database
  DATABASE_URL: Joi.string().required(),

  // Redis (optional - only needed if using queues/sessions)
  REDIS_HOST: Joi.string().optional(),
  REDIS_PORT: Joi.number().optional(),
  REDIS_PASSWORD: Joi.string().allow("").optional(),

  // WhatsApp Business API
  WHATSAPP_BUSINESS_ACCOUNT_ID: Joi.string().allow("").optional(),
  WHATSAPP_ACCESS_TOKEN: Joi.string().allow("").optional(),
  WHATSAPP_WEBHOOK_VERIFY_TOKEN: Joi.string().allow("").optional(),
  WHATSAPP_PHONE_NUMBER_ID: Joi.string().allow("").optional(),

  // Payment Gateway
  PAYMENT_GATEWAY_API_KEY: Joi.string().allow("").optional(),
  PAYMENT_GATEWAY_SECRET: Joi.string().allow("").optional(),
  PAYMENT_GATEWAY_WEBHOOK_SECRET: Joi.string().allow("").optional(),

  // Business Settings
  BUSINESS_NAME: Joi.string().default("Your Business"),
  BUSINESS_ACCOUNT_NUMBER: Joi.string().allow("").optional(),
  BUSINESS_BANK_NAME: Joi.string().allow("").optional(),
  TAX_RATE: Joi.number().default(0.0),
  PAYMENT_TIMEOUT_MINUTES: Joi.number().default(30),
});
