import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface VerificationResult {
  verified: boolean;
  confidence: number;
  details: {
    referenceFound: boolean;
    amountFound: boolean;
    accountFound: boolean;
    successFound: boolean;
    extractedText: string;
    issues?: string[];
  };
}

export interface ExpectedPayment {
  reference: string;
  amount: number;
  accountNumber: string;
  bankName?: string;
}

export interface OCRResult {
  text: string;
  confidence: number;
}

@Injectable()
export class ReceiptVerificationService {
  private readonly logger = new Logger(ReceiptVerificationService.name);

  constructor(private readonly configService: ConfigService) {}

  /**
   * Verify payment receipt image using OCR
   * Requirements: Bank transfer verification via image analysis
   */
  async verifyReceiptImage(
    imageBuffer: Buffer,
    expectedPayment: ExpectedPayment,
  ): Promise<VerificationResult> {
    try {
      this.logger.log(`Verifying receipt image for payment reference: ${expectedPayment.reference}`);

      // Extract text from image using OCR
      const ocrResult = await this.extractTextFromImage(imageBuffer);
      
      if (!ocrResult.text || ocrResult.text.trim().length === 0) {
        return {
          verified: false,
          confidence: 0,
          details: {
            referenceFound: false,
            amountFound: false,
            accountFound: false,
            successFound: false,
            extractedText: '',
            issues: ['No text could be extracted from the image'],
          },
        };
      }

      // Parse and verify the extracted text
      const verification = await this.parseReceiptData(ocrResult.text, expectedPayment);

      this.logger.log(
        `Receipt verification completed with ${verification.confidence}% confidence`,
        {
          reference: expectedPayment.reference,
          verified: verification.verified,
          confidence: verification.confidence,
        },
      );

      return verification;
    } catch (error) {
      this.logger.error(`Failed to verify receipt image: ${error.message}`);
      return {
        verified: false,
        confidence: 0,
        details: {
          referenceFound: false,
          amountFound: false,
          accountFound: false,
          successFound: false,
          extractedText: '',
          issues: [`Verification failed: ${error.message}`],
        },
      };
    }
  }

  /**
   * Extract text from image using OCR service
   */
  private async extractTextFromImage(imageBuffer: Buffer): Promise<OCRResult> {
    const ocrProvider = this.configService.get<string>('OCR_PROVIDER') || 'tesseract';

    try {
      // Preprocess image for better OCR accuracy
      const processedBuffer = await this.preprocessImage(imageBuffer);

      switch (ocrProvider.toLowerCase()) {
        case 'google':
          return await this.extractWithGoogleVision(processedBuffer);
        case 'aws':
          return await this.extractWithAWSTextract(processedBuffer);
        case 'azure':
          return await this.extractWithAzureVision(processedBuffer);
        case 'tesseract':
        default:
          return await this.extractWithTesseract(processedBuffer);
      }
    } catch (error) {
      this.logger.error(`OCR extraction failed: ${error.message}`);
      // Fallback to original image if preprocessing fails
      return await this.extractWithTesseract(imageBuffer);
    }
  }

  /**
   * Preprocess image to improve OCR accuracy
   */
  private async preprocessImage(imageBuffer: Buffer): Promise<Buffer> {
    try {
      // For now, return the original buffer
      // In a production environment, you might want to add image preprocessing:
      // - Convert to grayscale
      // - Adjust contrast and brightness
      // - Remove noise
      // - Resize if too small/large
      
      // This would require a library like Sharp:
      // const sharp = require('sharp');
      // return await sharp(imageBuffer)
      //   .grayscale()
      //   .normalize()
      //   .sharpen()
      //   .toBuffer();
      
      return imageBuffer;
    } catch (error) {
      this.logger.warn(`Image preprocessing failed: ${error.message}`);
      return imageBuffer;
    }
  }

  /**
   * Extract text using Tesseract.js (free, local processing)
   */
  private async extractWithTesseract(imageBuffer: Buffer): Promise<OCRResult> {
    try {
      this.logger.log('Using Tesseract OCR for text extraction');
      
      // Import Tesseract.js dynamically
      const { createWorker, PSM } = await import('tesseract.js');
      
      // Create and configure worker
      const worker = await createWorker('eng');
      
      // Configure for better accuracy with receipts
      await worker.setParameters({
        tessedit_char_whitelist: '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-:.,₦ ',
        tessedit_pageseg_mode: PSM.SINGLE_BLOCK,
      });
      
      // Perform OCR
      const { data: { text, confidence } } = await worker.recognize(imageBuffer);
      
      // Clean up worker
      await worker.terminate();
      
      this.logger.log(`Tesseract OCR completed with ${confidence}% confidence`);
      
      return {
        text: text || '',
        confidence: confidence || 0,
      };
    } catch (error) {
      this.logger.error(`Tesseract OCR failed: ${error.message}`);
      throw new Error(`OCR processing failed: ${error.message}`);
    }
  }

  /**
   * Extract text using Google Vision API
   */
  private async extractWithGoogleVision(imageBuffer: Buffer): Promise<OCRResult> {
    try {
      this.logger.log('Using Google Vision API for text extraction');
      
      // Note: This would require @google-cloud/vision package
      // const vision = require('@google-cloud/vision');
      // const client = new vision.ImageAnnotatorClient();
      // const [result] = await client.textDetection({ image: { content: imageBuffer } });
      // const detections = result.textAnnotations;
      // const text = detections[0]?.description || '';
      
      // For demo purposes, return simulated result
      return {
        text: 'Simulated Google Vision extraction - implement with actual API',
        confidence: 95,
      };
    } catch (error) {
      this.logger.error(`Google Vision API failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * Extract text using AWS Textract
   */
  private async extractWithAWSTextract(imageBuffer: Buffer): Promise<OCRResult> {
    try {
      this.logger.log('Using AWS Textract for text extraction');
      
      // Note: This would require aws-sdk package
      // const AWS = require('aws-sdk');
      // const textract = new AWS.Textract();
      // const result = await textract.detectDocumentText({
      //   Document: { Bytes: imageBuffer }
      // }).promise();
      
      // For demo purposes, return simulated result
      return {
        text: 'Simulated AWS Textract extraction - implement with actual API',
        confidence: 90,
      };
    } catch (error) {
      this.logger.error(`AWS Textract failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * Extract text using Azure Computer Vision
   */
  private async extractWithAzureVision(imageBuffer: Buffer): Promise<OCRResult> {
    try {
      this.logger.log('Using Azure Computer Vision for text extraction');
      
      // Note: This would require @azure/cognitiveservices-computervision package
      // const { ComputerVisionClient } = require('@azure/cognitiveservices-computervision');
      // const { CognitiveServicesCredentials } = require('@azure/ms-rest-azure-js');
      
      // For demo purposes, return simulated result
      return {
        text: 'Simulated Azure Vision extraction - implement with actual API',
        confidence: 92,
      };
    } catch (error) {
      this.logger.error(`Azure Computer Vision failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * Parse extracted text and verify payment details
   */
  private async parseReceiptData(
    text: string,
    expected: ExpectedPayment,
  ): Promise<VerificationResult> {
    const normalizedText = text.toLowerCase().replace(/\s+/g, ' ');
    const issues: string[] = [];

    // Check for payment reference
    const referenceFound = this.findPaymentReference(normalizedText, expected.reference);
    if (!referenceFound) {
      issues.push(`Payment reference "${expected.reference}" not found`);
    }

    // Check for amount
    const amountFound = this.findAmount(normalizedText, expected.amount);
    if (!amountFound) {
      issues.push(`Amount "${expected.amount}" not found`);
    }

    // Check for account number
    const accountFound = this.findAccountNumber(normalizedText, expected.accountNumber);
    if (!accountFound) {
      issues.push(`Account number "${expected.accountNumber}" not found`);
    }

    // Check for success indicators
    const successFound = this.findSuccessIndicators(normalizedText);
    if (!successFound) {
      issues.push('No success confirmation found in receipt');
    }

    // Check for failure indicators (should not be present)
    const failureFound = this.findFailureIndicators(normalizedText);
    if (failureFound) {
      issues.push('Receipt shows transaction failure');
    }

    // Calculate confidence score
    let confidence = 0;
    if (referenceFound) confidence += 40;
    if (amountFound) confidence += 30;
    if (accountFound) confidence += 20;
    if (successFound) confidence += 10;
    if (failureFound) confidence -= 50; // Heavily penalize failure indicators

    // Ensure confidence doesn't go below 0
    confidence = Math.max(0, confidence);

    // Amount and reference are critical - both must be found for verification
    const verified = confidence >= 70 && !failureFound && referenceFound && amountFound;

    return {
      verified,
      confidence,
      details: {
        referenceFound,
        amountFound,
        accountFound,
        successFound,
        extractedText: text,
        issues: issues.length > 0 ? issues : undefined,
      },
    };
  }

  /**
   * Find payment reference in text
   */
  private findPaymentReference(text: string, reference: string): boolean {
    const normalizedReference = reference.toLowerCase().replace(/[-\s]/g, '');
    const normalizedText = text.replace(/[-\s]/g, '');
    
    // Look for exact match
    if (normalizedText.includes(normalizedReference)) {
      return true;
    }

    // Look for partial matches (at least 8 characters)
    if (normalizedReference.length >= 8) {
      const partialRef = normalizedReference.substring(0, 8);
      return normalizedText.includes(partialRef);
    }

    return false;
  }

  /**
   * Find amount in text with various formats
   */
  private findAmount(text: string, expectedAmount: number): boolean {
    // Convert expected amount to string for easier matching
    const expectedStr = expectedAmount.toString();
    const expectedWithDecimals = expectedAmount.toFixed(2);
    const expectedWithCommas = expectedAmount.toLocaleString();

    // Simple string contains check for exact matches
    if (text.includes(expectedStr) || 
        text.includes(expectedWithDecimals) || 
        text.includes(expectedWithCommas)) {
      return true;
    }

    // Look for various amount formats with regex
    const amountPatterns = [
      // ₦5,000.00, ₦5000, NGN 5000, Amount: ₦5000, Amount: 5000
      /(?:₦|ngn|naira|amount:?)\s*(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)/gi,
      // 5,000.00, 5000.00 (decimal numbers)
      /(\d{1,3}(?:,\d{3})*\.\d{2})/g,
      // 5,000, 5000 (whole numbers with word boundaries)
      /\b(\d{1,3}(?:,\d{3})*)\b/g,
    ];

    for (const pattern of amountPatterns) {
      const matches = [...text.matchAll(pattern)];
      for (const match of matches) {
        const amount = parseFloat(match[1].replace(/,/g, ''));
        // Allow small rounding differences (within 1 unit)
        if (Math.abs(amount - expectedAmount) <= 1) {
          return true;
        }
      }
    }

    return false;
  }

  /**
   * Find account number in text
   */
  private findAccountNumber(text: string, accountNumber: string): boolean {
    // Remove spaces and look for exact match
    const normalizedAccount = accountNumber.replace(/\s/g, '');
    const normalizedText = text.replace(/\s/g, '');
    
    return normalizedText.includes(normalizedAccount);
  }

  /**
   * Find success indicators in text
   */
  private findSuccessIndicators(text: string): boolean {
    const successKeywords = [
      'successful', 'success', 'completed', 'complete', 'confirmed', 'confirm',
      'approved', 'approve', 'sent', 'transferred', 'processed', 'done',
      'credited', 'debited', 'transaction successful', 'payment successful'
    ];

    return successKeywords.some(keyword => text.includes(keyword));
  }

  /**
   * Find failure indicators in text
   */
  private findFailureIndicators(text: string): boolean {
    const failureKeywords = [
      'failed', 'failure', 'declined', 'rejected', 'cancelled', 'canceled',
      'insufficient', 'error', 'unsuccessful', 'not successful', 'invalid',
      'expired', 'timeout', 'unable to process'
    ];

    return failureKeywords.some(keyword => text.includes(keyword));
  }

  /**
   * Format verification issues for user display
   */
  formatVerificationIssues(verification: VerificationResult): string {
    if (!verification.details.issues || verification.details.issues.length === 0) {
      return 'Receipt verification completed successfully.';
    }

    return verification.details.issues
      .map((issue, index) => `${index + 1}. ${issue}`)
      .join('\n');
  }
}