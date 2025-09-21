import { IncomingMessage } from "./whatsapp.interface";

export interface ParsedMessage {
  id: string;
  from: string;
  content: string;
  type: MessageType;
  timestamp: number;
  originalMessage: IncomingMessage;
}

export enum MessageType {
  TEXT = "text",
  IMAGE = "image",
  DOCUMENT = "document",
  AUDIO = "audio",
  VIDEO = "video",
  LOCATION = "location",
  CONTACT = "contact",
  UNKNOWN = "unknown",
}

export interface ValidationResult {
  isValid: boolean;
  errors: string[];
}

export interface MessageProcessingContext {
  messageId: string;
  phoneNumber: string;
  timestamp: number;
  processingStartTime: number;
}

export interface MessageProcessingResult {
  messageId: string;
  phoneNumber: string;
  success: boolean;
  status: ProcessingStatus;
  errors: string[];
  processingTime: number;
  timestamp: number;
}

export type ProcessingStatus =
  | "SUCCESS"
  | "STRUCTURE_VALIDATION_FAILED"
  | "PARSING_FAILED"
  | "CONTENT_VALIDATION_FAILED"
  | "PROCESSING_ERROR";
