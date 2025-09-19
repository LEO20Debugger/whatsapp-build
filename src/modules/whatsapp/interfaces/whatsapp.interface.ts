export interface IncomingMessage {
  id: string;
  from: string;
  timestamp: number;
  text?: {
    body: string;
  };
  type?: string;

  // for media messages (images, audio, video, documents)
  mediaUrls?: string[];
}

export interface WhatsAppContact {
  profile: {
    name: string;
  };
  wa_id: string;
}

export interface WebhookVerificationQuery {
  "hub.mode": string;
  "hub.challenge": string;
  "hub.verify_token": string;
}

export interface WhatsAppWebhookPayload {
  object: string;
  entry: Array<{
    id: string;
    changes: Array<{
      value: {
        messaging_product: string;
        metadata?: {
          display_phone_number: string;
          phone_number_id: string;
        };
        contacts?: WhatsAppContact[];
        messages?: IncomingMessage[];
      };
      field: string;
    }>;
  }>;
}
