import { Test, TestingModule } from "@nestjs/testing";
import { ConfigService } from "@nestjs/config";
import {
  HttpException,
  HttpStatus,
  BadRequestException,
  UnauthorizedException,
} from "@nestjs/common";
import { WhatsAppWebhookController } from "./whatsapp-webhook.controller";
import { WhatsAppWebhookDto } from "../dto/whatsapp-webhook.dto";
import { WebhookVerificationDto } from "../dto/webhook-verification.dto";

describe("WhatsAppWebhookController", () => {
  let controller: WhatsAppWebhookController;
  let configService: ConfigService;

  const mockConfigService = {
    get: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [WhatsAppWebhookController],
      providers: [
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
      ],
    }).compile();

    controller = module.get<WhatsAppWebhookController>(
      WhatsAppWebhookController,
    );
    configService = module.get<ConfigService>(ConfigService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("verifyWebhook", () => {
    const mockQuery: WebhookVerificationDto = {
      "hub.mode": "subscribe",
      "hub.challenge": "test-challenge-123",
      "hub.verify_token": "test-verify-token",
    };

    it("should return challenge when verification is successful", () => {
      mockConfigService.get.mockReturnValue("test-verify-token");

      const result = controller.verifyWebhook(mockQuery);

      expect(result).toBe("test-challenge-123");
      expect(configService.get).toHaveBeenCalledWith(
        "WHATSAPP_WEBHOOK_VERIFY_TOKEN",
      );
    });

    it("should throw UnauthorizedException when token does not match", () => {
      mockConfigService.get.mockReturnValue("different-token");

      expect(() => controller.verifyWebhook(mockQuery)).toThrow(
        UnauthorizedException,
      );
    });

    it("should throw UnauthorizedException when mode is not subscribe", () => {
      mockConfigService.get.mockReturnValue("test-verify-token");
      const invalidQuery = { ...mockQuery, "hub.mode": "invalid-mode" };

      expect(() => controller.verifyWebhook(invalidQuery)).toThrow(
        UnauthorizedException,
      );
    });

    it("should throw HttpException when verify token is not configured", () => {
      mockConfigService.get.mockReturnValue(undefined);

      expect(() => controller.verifyWebhook(mockQuery)).toThrow(
        new HttpException(
          "Webhook verification token not configured",
          HttpStatus.INTERNAL_SERVER_ERROR,
        ),
      );
    });
  });

  describe("handleIncomingMessage", () => {
    const validPayload: WhatsAppWebhookDto = {
      object: "whatsapp_business_account",
      entry: [
        {
          id: "entry-id-123",
          changes: [
            {
              value: {
                messaging_product: "whatsapp",
                metadata: {
                  display_phone_number: "+1234567890",
                  phone_number_id: "phone-id-123",
                },
                messages: [
                  {
                    from: "+1987654321",
                    id: "message-id-123",
                    timestamp: 1234567890,
                    text: {
                      body: "Hello, I want to place an order",
                    },
                    type: "text",
                  },
                ],
              },
              field: "messages",
            },
          ],
        },
      ],
    };

    it("should process valid webhook payload successfully", async () => {
      const result = await controller.handleIncomingMessage(validPayload);

      expect(result).toEqual({ status: "success" });
    });

    it("should throw BadRequestException for invalid object type", async () => {
      const invalidPayload = {
        ...validPayload,
        object: "invalid_object",
      };

      await expect(
        controller.handleIncomingMessage(invalidPayload),
      ).rejects.toThrow(BadRequestException);
    });

    it("should throw BadRequestException when entry is not an array", async () => {
      const invalidPayload = {
        ...validPayload,
        entry: null as any,
      };

      await expect(
        controller.handleIncomingMessage(invalidPayload),
      ).rejects.toThrow(BadRequestException);
    });

    it("should handle payload with no messages gracefully", async () => {
      const payloadWithoutMessages: WhatsAppWebhookDto = {
        object: "whatsapp_business_account",
        entry: [
          {
            id: "entry-id-123",
            changes: [
              {
                value: {
                  messaging_product: "whatsapp",
                  metadata: {
                    display_phone_number: "+1234567890",
                    phone_number_id: "phone-id-123",
                  },
                },
                field: "messages",
              },
            ],
          },
        ],
      };

      const result = await controller.handleIncomingMessage(
        payloadWithoutMessages,
      );

      expect(result).toEqual({ status: "success" });
    });

    it("should skip non-message changes", async () => {
      const payloadWithStatusChange: WhatsAppWebhookDto = {
        object: "whatsapp_business_account",
        entry: [
          {
            id: "entry-id-123",
            changes: [
              {
                value: {
                  messaging_product: "whatsapp",
                  metadata: {
                    display_phone_number: "+1234567890",
                    phone_number_id: "phone-id-123",
                  },
                },
                field: "message_status", // Non-message field
              },
            ],
          },
        ],
      };

      const result = await controller.handleIncomingMessage(
        payloadWithStatusChange,
      );

      expect(result).toEqual({ status: "success" });
    });

    it("should handle multiple messages in single payload", async () => {
      const multiMessagePayload: WhatsAppWebhookDto = {
        object: "whatsapp_business_account",
        entry: [
          {
            id: "entry-id-123",
            changes: [
              {
                value: {
                  messaging_product: "whatsapp",
                  messages: [
                    {
                      from: "+1987654321",
                      id: "message-id-1",
                      timestamp: 1234567890,
                      text: { body: "First message" },
                      type: "text",
                    },
                    {
                      from: "+1987654321",
                      id: "message-id-2",
                      timestamp: 1234567891,
                      text: { body: "Second message" },
                      type: "text",
                    },
                  ],
                },
                field: "messages",
              },
            ],
          },
        ],
      };

      const result =
        await controller.handleIncomingMessage(multiMessagePayload);

      expect(result).toEqual({ status: "success" });
    });

    it("should handle messages without text content", async () => {
      const imageMessagePayload: WhatsAppWebhookDto = {
        object: "whatsapp_business_account",
        entry: [
          {
            id: "entry-id-123",
            changes: [
              {
                value: {
                  messaging_product: "whatsapp",
                  messages: [
                    {
                      from: "+1987654321",
                      id: "message-id-123",
                      timestamp: 1234567890,
                      type: "image",
                    },
                  ],
                },
                field: "messages",
              },
            ],
          },
        ],
      };

      const result =
        await controller.handleIncomingMessage(imageMessagePayload);

      expect(result).toEqual({ status: "success" });
    });

    it("should handle invalid message structure gracefully", async () => {
      const invalidMessagePayload: WhatsAppWebhookDto = {
        object: "whatsapp_business_account",
        entry: [
          {
            id: "entry-id-123",
            changes: [
              {
                value: {
                  messaging_product: "whatsapp",
                  messages: [
                    {
                      // Missing required fields
                      timestamp: 1234567890,
                      type: "text",
                    } as any,
                  ],
                },
                field: "messages",
              },
            ],
          },
        ],
      };

      const result = await controller.handleIncomingMessage(
        invalidMessagePayload,
      );

      expect(result).toEqual({ status: "success" });
    });

    it("should handle entry with invalid changes structure", async () => {
      const invalidChangesPayload: WhatsAppWebhookDto = {
        object: "whatsapp_business_account",
        entry: [
          {
            id: "entry-id-123",
            changes: null as any,
          },
        ],
      };

      const result = await controller.handleIncomingMessage(
        invalidChangesPayload,
      );

      expect(result).toEqual({ status: "success" });
    });
  });
});
