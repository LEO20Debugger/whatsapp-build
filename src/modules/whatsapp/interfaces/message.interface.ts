export interface MessageContent {
  type: "text" | "template";
  text?: {
    body: string;
    preview_url?: boolean;
  };
  template?: TemplateMessage;
}

export interface TemplateMessage {
  name: string;
  language: {
    code: string;
  };
  components?: TemplateComponent[];
}

export interface TemplateComponent {
  type: "header" | "body" | "button";
  parameters?: TemplateParameter[];
}

export interface TemplateParameter {
  type: "text";
  text: string;
}

export interface WhatsAppApiResponse {
  messaging_product: string;
  contacts: Array<{
    input: string;
    wa_id: string;
  }>;
  messages: Array<{
    id: string;
  }>;
}

export interface WhatsAppApiError {
  error: {
    message: string;
    type: string;
    code: number;
    error_data?: {
      messaging_product: string;
      details: string;
    };
    error_subcode?: number;
    fbtrace_id?: string;
  };
}
