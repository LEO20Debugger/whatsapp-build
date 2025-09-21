export const QUEUE_NAMES = {
  MESSAGE_RETRY: "message-retry",
  PAYMENT_VERIFICATION: "payment-verification",
  RECEIPT_GENERATION: "receipt-generation",
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];
