import { Injectable, Logger } from "@nestjs/common";
// Removed ConversationService to avoid circular dependency
import { PaymentsService } from "../../payments/payments.service";
import { WhatsAppMessageService } from "../../whatsapp/services/whatsapp-message.service";
import { ReceiptVerificationService, ExpectedPayment } from "../../payments/services/receipt-verification.service";
import { PdfReceiptService, ReceiptData } from "../../payments/services/pdf-receipt.service";
import { ConversationSession, ConversationState } from "../types/conversation.types";
import { ContextKey } from "../types/state-machine.types";

export interface PaymentFlowResult {
  success: boolean;
  message: string;
  paymentReference?: string;
  error?: string;
}

export interface PaymentConfirmationResult {
  success: boolean;
  message: string;
  receiptSent?: boolean;
  error?: string;
}

@Injectable()
export class PaymentFlowIntegrationService {
  private readonly logger = new Logger(PaymentFlowIntegrationService.name);

  constructor(
    private readonly paymentsService: PaymentsService,
    private readonly whatsappMessageService: WhatsAppMessageService,
    private readonly receiptVerificationService: ReceiptVerificationService,
    private readonly pdfReceiptService: PdfReceiptService,
  ) {}

  /**
   * Send payment instructions via WhatsApp
   * Requirements: 2.1, 2.2
   */
  async sendPaymentInstructions(
    phoneNumber: string,
    orderId: string,
    paymentMethod: "bank_transfer" | "card"
  ): Promise<PaymentFlowResult> {
    try {
      this.logger.log(`Sending payment instructions to ${phoneNumber} for order ${orderId}`);

      // Generate payment instructions
      const paymentInstructions = await this.paymentsService.generatePaymentInstructions(
        orderId,
        paymentMethod
      );

      // Create payment record
      const payment = await this.paymentsService.createPayment({
        orderId,
        paymentMethod,
      });

      // Format instructions message for WhatsApp
      let instructionsMessage = `💳 *PAYMENT INSTRUCTIONS*\n\n`;
      instructionsMessage += `💰 Amount: ${paymentInstructions.amount.toLocaleString("en-NG", {
        style: "currency",
        currency: "NGN",
        minimumFractionDigits: 0,
      })}\n`;
      instructionsMessage += `🔢 Reference: ${paymentInstructions.paymentReference}\n\n`;

      // Add method-specific instructions
      paymentInstructions.instructions.forEach((instruction, index) => {
        instructionsMessage += `${index === 0 ? '📋' : '  '} ${instruction}\n`;
      });

      instructionsMessage += `\n⏰ *Payment expires at:* ${paymentInstructions.expiresAt.toLocaleString()}\n\n`;
      instructionsMessage += `✅ After making payment, reply with "paid" to confirm your payment.`;

      // Send via WhatsApp
      await this.whatsappMessageService.sendTextMessage(phoneNumber, instructionsMessage);

      // Payment reference will be stored by the calling conversation service

      this.logger.log(`Payment instructions sent successfully to ${phoneNumber}`);

      return {
        success: true,
        message: "Payment instructions sent successfully",
        paymentReference: paymentInstructions.paymentReference,
      };
    } catch (error) {
      this.logger.error(`Failed to send payment instructions to ${phoneNumber}: ${error.message}`);
      return {
        success: false,
        message: "Failed to send payment instructions",
        error: error.message,
      };
    }
  }

  /**
   * Process payment confirmation and send receipt
   * Requirements: 3.1, 3.2, 4.1, 4.3
   */
  async processPaymentConfirmation(
    phoneNumber: string,
    paymentReference: string,
    confirmationData: {
      paymentMethod?: string;
      transactionId?: string;
      userInput?: string;
    }
  ): Promise<PaymentConfirmationResult> {
    try {
      this.logger.log(`Processing payment confirmation for ${phoneNumber} with reference ${paymentReference}`);

      // Verify payment using payment service
      const verificationResult = await this.paymentsService.verifyPayment({
        paymentReference,
        verificationData: {
          ...confirmationData,
          confirmedAt: new Date(),
          phoneNumber,
        },
      });

      if (!verificationResult.success) {
        // Send failure message via WhatsApp
        const failureMessage = `❌ *Payment Verification Failed*\n\n${verificationResult.message}\n\nPlease check your payment details and try again.\n\n💡 Make sure you:\n• Used the correct payment reference\n• Paid the exact amount\n• Completed the transaction\n\nReply with your transaction details or contact support if you need help.`;
        
        await this.whatsappMessageService.sendTextMessage(phoneNumber, failureMessage);

        return {
          success: false,
          message: verificationResult.message,
        };
      }

      // Generate and send receipt
      const receipt = await this.paymentsService.generateReceipt(verificationResult.payment.id);
      const receiptMessage = this.formatReceiptForWhatsApp(receipt);

      // Generate PDF receipt
      const pdfResult = await this.generateAndSendPdfReceipt(phoneNumber, receipt);

      const successMessage = `🎉 *PAYMENT CONFIRMED!*\n\nThank you! Your payment has been verified successfully.\n\n${receiptMessage}\n\n✅ Your order is now complete!\n\n${pdfResult.success ? '📄 A detailed PDF receipt has been sent to you.' : ''}\n\nType "new order" to place another order or "help" for support options.`;

      await this.whatsappMessageService.sendTextMessage(phoneNumber, successMessage);

      this.logger.log(`Payment confirmation processed successfully for ${phoneNumber}`);

      return {
        success: true,
        message: "Payment confirmed and receipt sent",
        receiptSent: true,
      };
    } catch (error) {
      this.logger.error(`Failed to process payment confirmation for ${phoneNumber}: ${error.message}`);

      // Send error message via WhatsApp
      const errorMessage = `Sorry, I had trouble verifying your payment. Please try again or contact support.\n\n📞 Support: support@business.com`;
      
      try {
        await this.whatsappMessageService.sendTextMessage(phoneNumber, errorMessage);
      } catch (msgError) {
        this.logger.error(`Failed to send error message: ${msgError.message}`);
      }

      return {
        success: false,
        message: "Failed to process payment confirmation",
        error: error.message,
      };
    }
  }

  /**
   * Send payment reminder
   * Requirements: 2.4
   */
  async sendPaymentReminder(
    phoneNumber: string,
    paymentReference: string,
    minutesUntilExpiry: number
  ): Promise<boolean> {
    try {
      this.logger.log(`Sending payment reminder to ${phoneNumber} for reference ${paymentReference}`);

      const reminderMessage = `⏰ *PAYMENT REMINDER*\n\nYour payment is due in ${minutesUntilExpiry} minutes!\n\n🔢 Reference: ${paymentReference}\n\nPlease complete your payment to avoid order cancellation.\n\nReply with "paid" after making payment.`;

      await this.whatsappMessageService.sendTextMessage(phoneNumber, reminderMessage);

      this.logger.log(`Payment reminder sent successfully to ${phoneNumber}`);
      return true;
    } catch (error) {
      this.logger.error(`Failed to send payment reminder to ${phoneNumber}: ${error.message}`);
      return false;
    }
  }

  /**
   * Send payment timeout notification
   * Requirements: 2.3, 2.4
   */
  async sendPaymentTimeout(
    phoneNumber: string,
    paymentReference: string
  ): Promise<boolean> {
    try {
      this.logger.log(`Sending payment timeout notification to ${phoneNumber}`);

      const timeoutMessage = `⏰ *PAYMENT EXPIRED*\n\nYour payment window has expired for reference: ${paymentReference}\n\nYour order has been cancelled. To place a new order, type "menu" to browse our products.\n\nFor assistance, contact support at support@business.com`;

      await this.whatsappMessageService.sendTextMessage(phoneNumber, timeoutMessage);

      this.logger.log(`Payment timeout notification sent to ${phoneNumber}`);
      return true;
    } catch (error) {
      this.logger.error(`Failed to send payment timeout notification to ${phoneNumber}: ${error.message}`);
      return false;
    }
  }

  /**
   * Resend receipt via WhatsApp
   * Requirements: 4.3, 4.4
   */
  async resendReceipt(
    phoneNumber: string,
    paymentId: string
  ): Promise<boolean> {
    try {
      this.logger.log(`Resending receipt to ${phoneNumber} for payment ${paymentId}`);

      // Get receipt from payment service
      const receipt = await this.paymentsService.getReceiptByPaymentId(paymentId);
      
      if (!receipt) {
        const notFoundMessage = `Sorry, I couldn't find your receipt. Please contact support if you need assistance.\n\n📞 Support: support@business.com`;
        await this.whatsappMessageService.sendTextMessage(phoneNumber, notFoundMessage);
        return false;
      }

      const receiptMessage = `📧 *RECEIPT RESENT*\n\nHere's your receipt again:\n\n${receipt.content}\n\nFor detailed receipts or support, contact:\n📞 Support: support@business.com\n📧 Email: orders@business.com`;

      await this.whatsappMessageService.sendTextMessage(phoneNumber, receiptMessage);

      this.logger.log(`Receipt resent successfully to ${phoneNumber}`);
      return true;
    } catch (error) {
      this.logger.error(`Failed to resend receipt to ${phoneNumber}: ${error.message}`);

      const errorMessage = `Sorry, I had trouble sending your receipt. Please contact support.\n\n📞 Support: support@business.com`;
      
      try {
        await this.whatsappMessageService.sendTextMessage(phoneNumber, errorMessage);
      } catch (msgError) {
        this.logger.error(`Failed to send error message: ${msgError.message}`);
      }

      return false;
    }
  }

  /**
   * Format receipt for WhatsApp message
   * Requirements: 4.1, 4.2
   */
  private formatReceiptForWhatsApp(receipt: any): string {
    let receiptMessage = `🧾 *DIGITAL RECEIPT*\n\n`;
    receiptMessage += `📄 Receipt #: ${receipt.receiptNumber}\n`;
    receiptMessage += `📅 Date: ${receipt.generatedAt.toLocaleDateString()}\n`;
    receiptMessage += `🕐 Time: ${receipt.generatedAt.toLocaleTimeString()}\n\n`;

    receiptMessage += `👤 *Customer:* ${receipt.customerInfo.name || 'N/A'}\n`;
    receiptMessage += `📱 Phone: ${receipt.customerInfo.phoneNumber}\n\n`;

    receiptMessage += `🛒 *ORDER DETAILS:*\n`;
    receipt.orderDetails.items.forEach((item: any, index: number) => {
      const itemTotal = item.totalPrice.toLocaleString("en-NG", {
        style: "currency",
        currency: "NGN",
        minimumFractionDigits: 0,
      });
      receiptMessage += `${index + 1}. ${item.name} x${item.quantity} - ${itemTotal}\n`;
    });

    const total = receipt.orderDetails.total.toLocaleString("en-NG", {
      style: "currency",
      currency: "NGN",
      minimumFractionDigits: 0,
    });

    receiptMessage += `\n💰 *Total: ${total}*\n\n`;

    receiptMessage += `💳 *Payment:* ${receipt.paymentDetails.method.replace('_', ' ').toUpperCase()}\n`;
    receiptMessage += `🔢 Reference: ${receipt.paymentDetails.reference}\n`;
    receiptMessage += `✅ Verified: ${receipt.paymentDetails.verifiedAt.toLocaleString()}\n\n`;

    receiptMessage += `🏢 *${receipt.businessInfo.name}*\n`;
    if (receipt.businessInfo.address) {
      receiptMessage += `📍 ${receipt.businessInfo.address}\n`;
    }
    if (receipt.businessInfo.phone) {
      receiptMessage += `📞 ${receipt.businessInfo.phone}`;
    }

    return receiptMessage;
  }

  /**
   * Verify payment receipt image
   * Requirements: Bank transfer verification via OCR
   */
  async verifyReceiptImage(
    phoneNumber: string,
    imageBuffer: Buffer,
    paymentReference: string
  ): Promise<PaymentConfirmationResult> {
    try {
      this.logger.log(`Verifying receipt image for ${phoneNumber} with reference ${paymentReference}`);

      // Get expected payment details
      const expectedPayment = await this.getExpectedPaymentDetails(paymentReference);
      if (!expectedPayment) {
        return {
          success: false,
          message: 'Payment reference not found or expired',
        };
      }

      // Verify receipt using OCR
      const verification = await this.receiptVerificationService.verifyReceiptImage(
        imageBuffer,
        expectedPayment
      );

      if (verification.verified) {
        // Process successful verification
        const confirmationResult = await this.processPaymentConfirmation(
          phoneNumber,
          paymentReference,
          {
            paymentMethod: 'bank_transfer',
            userInput: `Receipt image uploaded - ${verification.confidence}% confidence`,
          }
        );

        return {
          success: true,
          message: `✅ *Payment Verified!*\n\nYour receipt has been confirmed with ${verification.confidence}% confidence.\n\nThank you for your payment!`,
          receiptSent: confirmationResult.receiptSent,
        };
      } else {
        // Verification failed
        const issuesText = this.receiptVerificationService.formatVerificationIssues(verification);
        
        const failureMessage = `❌ *Receipt Verification Failed*\n\nI couldn't verify your receipt automatically (${verification.confidence}% confidence).\n\n*Issues found:*\n${issuesText}\n\n*Please try:*\n• Taking a clearer photo\n• Ensuring all text is visible\n• Including the full receipt\n\n*Or:*\n• Type your transaction reference manually\n• Contact support for manual verification\n\n📞 Support: support@business.com`;

        await this.whatsappMessageService.sendTextMessage(phoneNumber, failureMessage);

        return {
          success: false,
          message: 'Receipt verification failed - manual review may be needed',
        };
      }
    } catch (error) {
      this.logger.error(`Failed to verify receipt image for ${phoneNumber}: ${error.message}`);

      const errorMessage = `❌ *Verification Error*\n\nSorry, I had trouble processing your receipt image.\n\nPlease try:\n• Uploading the image again\n• Typing your transaction reference manually\n• Contacting support\n\n📞 Support: support@business.com`;

      try {
        await this.whatsappMessageService.sendTextMessage(phoneNumber, errorMessage);
      } catch (msgError) {
        this.logger.error(`Failed to send verification error message: ${msgError.message}`);
      }

      return {
        success: false,
        message: `Receipt verification error: ${error.message}`,
      };
    }
  }

  /**
   * Download image from WhatsApp and verify receipt
   * Requirements: WhatsApp image handling for receipt verification
   */
  async handleReceiptImageFromWhatsApp(
    phoneNumber: string,
    imageUrl: string,
    paymentReference: string
  ): Promise<PaymentConfirmationResult> {
    try {
      this.logger.log(`🔍 Starting receipt image processing for ${phoneNumber}`);
      this.logger.log(`📱 Image URL: ${imageUrl}`);
      this.logger.log(`🔢 Payment Reference: ${paymentReference}`);

      // Check if we're in development mode
      const nodeEnv = process.env.NODE_ENV;
      const devMode = process.env.WHATSAPP_DEV_MODE;
      const isDevelopment = nodeEnv === 'development' || devMode === 'true';
      
      this.logger.log(`🔧 Environment Check - NODE_ENV: ${nodeEnv}, WHATSAPP_DEV_MODE: ${devMode}, isDevelopment: ${isDevelopment}`);
      
      if (isDevelopment) {
        // In development mode, simulate successful receipt verification
        this.logger.log(`🚀 Development mode: Simulating successful receipt verification for ${phoneNumber}`);
        
        try {
          // Process successful verification using the payment confirmation flow
          this.logger.log(`💳 Processing payment confirmation for ${phoneNumber}`);
          const confirmationResult = await this.processPaymentConfirmation(
            phoneNumber,
            paymentReference,
            {
              paymentMethod: 'bank_transfer',
              userInput: `Receipt image uploaded - Development mode simulation`,
            }
          );

          this.logger.log(`✅ Payment confirmation completed for ${phoneNumber}. Receipt sent: ${confirmationResult.receiptSent}`);

          return {
            success: true,
            message: `✅ *Payment Verified!* (Development Mode)\n\nYour receipt has been confirmed.\n\nThank you for your payment!`,
            receiptSent: confirmationResult.receiptSent,
          };
        } catch (confirmationError) {
          this.logger.error(`❌ Error in payment confirmation: ${confirmationError.message}`);
          throw confirmationError;
        }
      }

      // Production mode: Download and verify actual image
      const imageBuffer = await this.downloadWhatsAppImage(imageUrl);

      // Verify the receipt
      return await this.verifyReceiptImage(phoneNumber, imageBuffer, paymentReference);
    } catch (error) {
      this.logger.error(`Failed to handle WhatsApp receipt image for ${phoneNumber}: ${error.message}`);
      return {
        success: false,
        message: `Failed to download or process image: ${error.message}`,
      };
    }
  }

  /**
   * Download image from WhatsApp URL
   */
  private async downloadWhatsAppImage(imageUrl: string): Promise<Buffer> {
    try {
      this.logger.log(`Downloading image from WhatsApp: ${imageUrl}`);
      
      // For development/demo purposes, simulate successful image download
      // In production, you would implement actual WhatsApp media download:
      // 1. Get WhatsApp access token
      // 2. Make authenticated request to WhatsApp media URL
      // 3. Download the image buffer
      
      // Create a mock image buffer with some content to simulate a receipt
      const mockReceiptContent = `
        BANK TRANSFER RECEIPT
        Date: ${new Date().toLocaleDateString()}
        Amount: NGN 2,000
        Reference: PAY-123
        Status: SUCCESSFUL
        Account: 1234567890
      `;
      
      return Buffer.from(mockReceiptContent, 'utf-8');
    } catch (error) {
      this.logger.error(`Failed to download WhatsApp image: ${error.message}`);
      throw new Error(`Image download failed: ${error.message}`);
    }
  }

  /**
   * Get expected payment details for verification
   */
  private async getExpectedPaymentDetails(paymentReference: string): Promise<ExpectedPayment | null> {
    try {
      // Find payment by reference
      const payment = await this.paymentsService.verifyPayment({
        paymentReference,
      });

      if (!payment.success) {
        return null;
      }

      // Use payment amount directly from the payment record
      return {
        reference: paymentReference,
        amount: parseFloat(payment.payment.amount),
        accountNumber: process.env.BANK_ACCOUNT_NUMBER || '1234567890',
        bankName: process.env.BANK_NAME || 'Main Bank',
      };
    } catch (error) {
      this.logger.error(`Failed to get expected payment details: ${error.message}`);
      return null;
    }
  }

  /**
   * Generate and send PDF receipt
   * Requirements: 4.1, 4.2, 4.3, 4.5
   */
  async generateAndSendPdfReceipt(
    phoneNumber: string,
    receipt: any
  ): Promise<{ success: boolean; error?: string }> {
    try {
      this.logger.log(`Generating PDF receipt for ${phoneNumber}`);

      // Convert receipt data to PDF format
      const receiptData: ReceiptData = {
        receiptNumber: receipt.receiptNumber,
        generatedAt: receipt.generatedAt,
        customerInfo: {
          name: receipt.customerInfo.name,
          phoneNumber: receipt.customerInfo.phoneNumber,
        },
        orderDetails: {
          orderId: receipt.orderDetails.orderId || 'N/A',
          items: receipt.orderDetails.items.map((item: any) => ({
            name: item.name,
            quantity: item.quantity,
            unitPrice: item.unitPrice || (item.totalPrice / item.quantity),
            totalPrice: item.totalPrice,
          })),
          subtotal: receipt.orderDetails.subtotal || receipt.orderDetails.total,
          tax: receipt.orderDetails.tax,
          total: receipt.orderDetails.total,
        },
        paymentDetails: {
          method: receipt.paymentDetails.method,
          reference: receipt.paymentDetails.reference,
          verifiedAt: receipt.paymentDetails.verifiedAt,
          amount: receipt.paymentDetails.amount || receipt.orderDetails.total,
        },
        businessInfo: {
          name: process.env.BUSINESS_NAME || 'Your Business',
          address: process.env.BUSINESS_ADDRESS,
          phone: process.env.BUSINESS_PHONE,
          email: process.env.BUSINESS_EMAIL,
          logo: process.env.BUSINESS_LOGO_URL,
        },
      };

      // Generate PDF
      const pdfResult = await this.pdfReceiptService.generatePdfReceipt(receiptData);

      if (!pdfResult.success) {
        this.logger.error(`Failed to generate PDF receipt: ${pdfResult.error}`);
        return { success: false, error: pdfResult.error };
      }

      // Send PDF via WhatsApp
      const caption = `📄 *Receipt for Order ${receiptData.orderDetails.orderId}*\n\nHere's your detailed payment receipt. Keep this for your records.\n\nThank you for your business! 🙏`;

      await this.whatsappMessageService.sendDocument(
        phoneNumber,
        pdfResult.filePath!,
        pdfResult.fileName,
        caption
      );

      this.logger.log(`PDF receipt sent successfully to ${phoneNumber}`);

      // Schedule cleanup of the PDF file after 24 hours
      setTimeout(async () => {
        try {
          await this.pdfReceiptService.deleteReceipt(pdfResult.fileName!);
        } catch (error) {
          this.logger.warn(`Failed to cleanup PDF receipt ${pdfResult.fileName}: ${error.message}`);
        }
      }, 24 * 60 * 60 * 1000); // 24 hours

      return { success: true };
    } catch (error) {
      this.logger.error(`Failed to generate and send PDF receipt to ${phoneNumber}: ${error.message}`);
      return { success: false, error: error.message };
    }
  }

  /**
   * Handle payment flow errors
   * Requirements: 7.1, 7.2
   */
  async handlePaymentError(
    phoneNumber: string,
    error: string,
    context?: any
  ): Promise<void> {
    try {
      this.logger.error(`Payment flow error for ${phoneNumber}: ${error}`, context);

      const errorMessage = `❌ *Payment Error*\n\nSorry, there was an issue processing your payment:\n\n${error}\n\nPlease try again or contact support for assistance.\n\n📞 Support: support@business.com`;

      await this.whatsappMessageService.sendTextMessage(phoneNumber, errorMessage);
    } catch (msgError) {
      this.logger.error(`Failed to send payment error message to ${phoneNumber}: ${msgError.message}`);
    }
  }
}