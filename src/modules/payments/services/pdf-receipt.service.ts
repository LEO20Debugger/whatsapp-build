import { Injectable, Logger } from '@nestjs/common';
import * as puppeteer from 'puppeteer';
import * as fs from 'fs/promises';
import * as path from 'path';

export interface ReceiptData {
  receiptNumber: string;
  generatedAt: Date;
  customerInfo: {
    name?: string;
    phoneNumber: string;
  };
  orderDetails: {
    orderId: string;
    items: Array<{
      name: string;
      quantity: number;
      unitPrice: number;
      totalPrice: number;
    }>;
    subtotal: number;
    tax?: number;
    total: number;
  };
  paymentDetails: {
    method: string;
    reference: string;
    verifiedAt: Date;
    amount: number;
  };
  businessInfo: {
    name: string;
    address?: string;
    phone?: string;
    email?: string;
    logo?: string;
  };
}

export interface PdfReceiptResult {
  success: boolean;
  filePath?: string;
  fileName?: string;
  error?: string;
}

@Injectable()
export class PdfReceiptService {
  private readonly logger = new Logger(PdfReceiptService.name);
  private readonly receiptsDir = path.join(process.cwd(), 'storage', 'receipts');

  constructor() {
    this.ensureReceiptsDirectory();
  }

  /**
   * Generate PDF receipt from receipt data
   */
  async generatePdfReceipt(receiptData: ReceiptData): Promise<PdfReceiptResult> {
    try {
      this.logger.log(`Generating PDF receipt for ${receiptData.receiptNumber}`);

      // Generate HTML content for the receipt
      const htmlContent = this.generateReceiptHtml(receiptData);

      // Generate PDF using Puppeteer
      const fileName = `receipt-${receiptData.receiptNumber}-${Date.now()}.pdf`;
      const filePath = path.join(this.receiptsDir, fileName);

      const browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
      });

      const page = await browser.newPage();
      await page.setContent(htmlContent, { waitUntil: 'networkidle0' });

      // Generate PDF with proper formatting
      await page.pdf({
        path: filePath,
        format: 'A4',
        printBackground: true,
        margin: {
          top: '20px',
          right: '20px',
          bottom: '20px',
          left: '20px'
        }
      });

      await browser.close();

      this.logger.log(`PDF receipt generated successfully: ${fileName}`);

      return {
        success: true,
        filePath,
        fileName
      };
    } catch (error) {
      this.logger.error(`Failed to generate PDF receipt: ${error.message}`);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Generate HTML content for the receipt
   */
  private generateReceiptHtml(data: ReceiptData): string {
    const formatCurrency = (amount: number) => {
      return amount.toLocaleString('en-NG', {
        style: 'currency',
        currency: 'NGN',
        minimumFractionDigits: 0
      });
    };

    const formatDate = (date: Date) => {
      return date.toLocaleDateString('en-NG', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
    };

    return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Receipt - ${data.receiptNumber}</title>
        <style>
            * {
                margin: 0;
                padding: 0;
                box-sizing: border-box;
            }
            
            body {
                font-family: 'Arial', sans-serif;
                line-height: 1.6;
                color: #333;
                background: #fff;
            }
            
            .receipt-container {
                max-width: 800px;
                margin: 0 auto;
                padding: 40px;
                background: #fff;
            }
            
            .header {
                text-align: center;
                margin-bottom: 40px;
                border-bottom: 3px solid #2563eb;
                padding-bottom: 20px;
            }
            
            .business-logo {
                width: 80px;
                height: 80px;
                margin: 0 auto 20px;
                background: #2563eb;
                border-radius: 50%;
                display: flex;
                align-items: center;
                justify-content: center;
                color: white;
                font-size: 24px;
                font-weight: bold;
            }
            
            .business-name {
                font-size: 28px;
                font-weight: bold;
                color: #2563eb;
                margin-bottom: 10px;
            }
            
            .business-details {
                color: #666;
                font-size: 14px;
            }
            
            .receipt-title {
                text-align: center;
                font-size: 24px;
                font-weight: bold;
                margin: 30px 0;
                color: #2563eb;
            }
            
            .receipt-info {
                display: flex;
                justify-content: space-between;
                margin-bottom: 30px;
                background: #f8fafc;
                padding: 20px;
                border-radius: 8px;
            }
            
            .receipt-info div {
                flex: 1;
            }
            
            .receipt-info h3 {
                font-size: 16px;
                margin-bottom: 10px;
                color: #2563eb;
            }
            
            .receipt-info p {
                margin: 5px 0;
                font-size: 14px;
            }
            
            .items-table {
                width: 100%;
                border-collapse: collapse;
                margin: 30px 0;
                background: #fff;
                border-radius: 8px;
                overflow: hidden;
                box-shadow: 0 2px 4px rgba(0,0,0,0.1);
            }
            
            .items-table th {
                background: #2563eb;
                color: white;
                padding: 15px;
                text-align: left;
                font-weight: bold;
            }
            
            .items-table td {
                padding: 15px;
                border-bottom: 1px solid #e5e7eb;
            }
            
            .items-table tr:last-child td {
                border-bottom: none;
            }
            
            .items-table tr:nth-child(even) {
                background: #f8fafc;
            }
            
            .text-right {
                text-align: right;
            }
            
            .totals-section {
                margin-top: 30px;
                text-align: right;
            }
            
            .total-row {
                display: flex;
                justify-content: space-between;
                padding: 10px 0;
                border-bottom: 1px solid #e5e7eb;
            }
            
            .total-row.final {
                font-size: 18px;
                font-weight: bold;
                color: #2563eb;
                border-bottom: 3px solid #2563eb;
                margin-top: 10px;
            }
            
            .payment-info {
                margin-top: 40px;
                background: #f0f9ff;
                padding: 20px;
                border-radius: 8px;
                border-left: 4px solid #2563eb;
            }
            
            .payment-info h3 {
                color: #2563eb;
                margin-bottom: 15px;
            }
            
            .payment-details {
                display: grid;
                grid-template-columns: 1fr 1fr;
                gap: 15px;
            }
            
            .payment-detail {
                display: flex;
                justify-content: space-between;
            }
            
            .payment-detail strong {
                color: #2563eb;
            }
            
            .footer {
                margin-top: 50px;
                text-align: center;
                padding-top: 30px;
                border-top: 2px solid #e5e7eb;
                color: #666;
                font-size: 14px;
            }
            
            .thank-you {
                font-size: 18px;
                font-weight: bold;
                color: #2563eb;
                margin-bottom: 15px;
            }
            
            .support-info {
                margin-top: 20px;
                background: #f8fafc;
                padding: 15px;
                border-radius: 8px;
            }
        </style>
    </head>
    <body>
        <div class="receipt-container">
            <!-- Header -->
            <div class="header">
                <div class="business-logo">
                    ${data.businessInfo.logo ? `<img src="${data.businessInfo.logo}" alt="Logo" style="width: 100%; height: 100%; object-fit: cover; border-radius: 50%;">` : data.businessInfo.name.charAt(0)}
                </div>
                <div class="business-name">${data.businessInfo.name}</div>
                <div class="business-details">
                    ${data.businessInfo.address ? `<p>${data.businessInfo.address}</p>` : ''}
                    ${data.businessInfo.phone ? `<p>Phone: ${data.businessInfo.phone}</p>` : ''}
                    ${data.businessInfo.email ? `<p>Email: ${data.businessInfo.email}</p>` : ''}
                </div>
            </div>
            
            <!-- Receipt Title -->
            <div class="receipt-title">PAYMENT RECEIPT</div>
            
            <!-- Receipt Info -->
            <div class="receipt-info">
                <div>
                    <h3>Receipt Details</h3>
                    <p><strong>Receipt #:</strong> ${data.receiptNumber}</p>
                    <p><strong>Date:</strong> ${formatDate(data.generatedAt)}</p>
                    <p><strong>Order ID:</strong> ${data.orderDetails.orderId}</p>
                </div>
                <div>
                    <h3>Customer Information</h3>
                    <p><strong>Name:</strong> ${data.customerInfo.name || 'N/A'}</p>
                    <p><strong>Phone:</strong> ${data.customerInfo.phoneNumber}</p>
                </div>
            </div>
            
            <!-- Items Table -->
            <table class="items-table">
                <thead>
                    <tr>
                        <th>Item</th>
                        <th class="text-right">Qty</th>
                        <th class="text-right">Unit Price</th>
                        <th class="text-right">Total</th>
                    </tr>
                </thead>
                <tbody>
                    ${data.orderDetails.items.map(item => `
                        <tr>
                            <td>${item.name}</td>
                            <td class="text-right">${item.quantity}</td>
                            <td class="text-right">${formatCurrency(item.unitPrice)}</td>
                            <td class="text-right">${formatCurrency(item.totalPrice)}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
            
            <!-- Totals -->
            <div class="totals-section">
                <div class="total-row">
                    <span>Subtotal:</span>
                    <span>${formatCurrency(data.orderDetails.subtotal)}</span>
                </div>
                ${data.orderDetails.tax ? `
                    <div class="total-row">
                        <span>Tax:</span>
                        <span>${formatCurrency(data.orderDetails.tax)}</span>
                    </div>
                ` : ''}
                <div class="total-row final">
                    <span>TOTAL PAID:</span>
                    <span>${formatCurrency(data.orderDetails.total)}</span>
                </div>
            </div>
            
            <!-- Payment Information -->
            <div class="payment-info">
                <h3>Payment Information</h3>
                <div class="payment-details">
                    <div class="payment-detail">
                        <span>Payment Method:</span>
                        <strong>${data.paymentDetails.method.replace('_', ' ').toUpperCase()}</strong>
                    </div>
                    <div class="payment-detail">
                        <span>Reference:</span>
                        <strong>${data.paymentDetails.reference}</strong>
                    </div>
                    <div class="payment-detail">
                        <span>Amount Paid:</span>
                        <strong>${formatCurrency(data.paymentDetails.amount)}</strong>
                    </div>
                    <div class="payment-detail">
                        <span>Verified At:</span>
                        <strong>${formatDate(data.paymentDetails.verifiedAt)}</strong>
                    </div>
                </div>
            </div>
            
            <!-- Footer -->
            <div class="footer">
                <div class="thank-you">Thank you for your business!</div>
                <p>This is a computer-generated receipt and does not require a signature.</p>
                
                <div class="support-info">
                    <p><strong>Need Help?</strong></p>
                    <p>Contact our support team for any questions about this receipt.</p>
                    ${data.businessInfo.phone ? `<p>Phone: ${data.businessInfo.phone}</p>` : ''}
                    ${data.businessInfo.email ? `<p>Email: ${data.businessInfo.email}</p>` : ''}
                </div>
            </div>
        </div>
    </body>
    </html>
    `;
  }

  /**
   * Clean up old receipt files
   */
  async cleanupOldReceipts(olderThanDays: number = 30): Promise<void> {
    try {
      const files = await fs.readdir(this.receiptsDir);
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - olderThanDays);

      for (const file of files) {
        if (file.endsWith('.pdf')) {
          const filePath = path.join(this.receiptsDir, file);
          const stats = await fs.stat(filePath);
          
          if (stats.mtime < cutoffDate) {
            await fs.unlink(filePath);
            this.logger.log(`Cleaned up old receipt: ${file}`);
          }
        }
      }
    } catch (error) {
      this.logger.error(`Failed to cleanup old receipts: ${error.message}`);
    }
  }

  /**
   * Get receipt file path
   */
  getReceiptPath(fileName: string): string {
    return path.join(this.receiptsDir, fileName);
  }

  /**
   * Check if receipt file exists
   */
  async receiptExists(fileName: string): Promise<boolean> {
    try {
      const filePath = this.getReceiptPath(fileName);
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Delete receipt file
   */
  async deleteReceipt(fileName: string): Promise<boolean> {
    try {
      const filePath = this.getReceiptPath(fileName);
      await fs.unlink(filePath);
      this.logger.log(`Deleted receipt: ${fileName}`);
      return true;
    } catch (error) {
      this.logger.error(`Failed to delete receipt ${fileName}: ${error.message}`);
      return false;
    }
  }

  /**
   * Ensure receipts directory exists
   */
  private async ensureReceiptsDirectory(): Promise<void> {
    try {
      await fs.mkdir(this.receiptsDir, { recursive: true });
    } catch (error) {
      this.logger.error(`Failed to create receipts directory: ${error.message}`);
    }
  }
}