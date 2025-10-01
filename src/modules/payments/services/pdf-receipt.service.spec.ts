import { Test, TestingModule } from '@nestjs/testing';
import { PdfReceiptService, ReceiptData } from './pdf-receipt.service';
import * as fs from 'fs/promises';
import * as path from 'path';

// Mock puppeteer
jest.mock('puppeteer', () => ({
  launch: jest.fn().mockResolvedValue({
    newPage: jest.fn().mockResolvedValue({
      setContent: jest.fn().mockResolvedValue(undefined),
      pdf: jest.fn().mockResolvedValue(undefined),
    }),
    close: jest.fn().mockResolvedValue(undefined),
  }),
}));

// Mock fs promises
jest.mock('fs/promises');

describe('PdfReceiptService', () => {
  let service: PdfReceiptService;
  let mockFs: jest.Mocked<typeof fs>;

  const mockReceiptData: ReceiptData = {
    receiptNumber: 'RCP-001',
    generatedAt: new Date('2024-01-01T10:00:00Z'),
    customerInfo: {
      name: 'John Doe',
      phoneNumber: '+2348012345678',
    },
    orderDetails: {
      orderId: 'ORD-001',
      items: [
        {
          name: 'Test Product',
          quantity: 2,
          unitPrice: 1000,
          totalPrice: 2000,
        },
      ],
      subtotal: 2000,
      tax: 160,
      total: 2160,
    },
    paymentDetails: {
      method: 'bank_transfer',
      reference: 'PAY-001',
      verifiedAt: new Date('2024-01-01T10:05:00Z'),
      amount: 2160,
    },
    businessInfo: {
      name: 'Test Business',
      address: '123 Test Street',
      phone: '+234-800-123-4567',
      email: 'test@business.com',
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [PdfReceiptService],
    }).compile();

    service = module.get<PdfReceiptService>(PdfReceiptService);
    mockFs = fs as jest.Mocked<typeof fs>;

    // Mock fs methods
    mockFs.mkdir = jest.fn().mockResolvedValue(undefined);
    mockFs.readdir = jest.fn().mockResolvedValue([]);
    mockFs.stat = jest.fn().mockResolvedValue({ mtime: new Date() } as any);
    mockFs.unlink = jest.fn().mockResolvedValue(undefined);
    mockFs.access = jest.fn().mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('generatePdfReceipt', () => {
    it('should generate PDF receipt successfully', async () => {
      const result = await service.generatePdfReceipt(mockReceiptData);

      expect(result.success).toBe(true);
      expect(result.filePath).toBeDefined();
      expect(result.fileName).toBeDefined();
      expect(result.fileName).toMatch(/^receipt-RCP-001-\d+\.pdf$/);
      expect(result.error).toBeUndefined();
    });

    it('should handle PDF generation errors', async () => {
      const puppeteer = require('puppeteer');
      puppeteer.launch.mockRejectedValueOnce(new Error('Puppeteer failed'));

      const result = await service.generatePdfReceipt(mockReceiptData);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Puppeteer failed');
      expect(result.filePath).toBeUndefined();
      expect(result.fileName).toBeUndefined();
    });

    it('should generate proper HTML content', async () => {
      const puppeteer = require('puppeteer');
      const mockPage = {
        setContent: jest.fn().mockResolvedValue(undefined),
        pdf: jest.fn().mockResolvedValue(undefined),
      };
      const mockBrowser = {
        newPage: jest.fn().mockResolvedValue(mockPage),
        close: jest.fn().mockResolvedValue(undefined),
      };
      puppeteer.launch.mockResolvedValue(mockBrowser);

      await service.generatePdfReceipt(mockReceiptData);

      expect(mockPage.setContent).toHaveBeenCalledWith(
        expect.stringContaining('Test Business'),
        { waitUntil: 'networkidle0' }
      );
      expect(mockPage.setContent).toHaveBeenCalledWith(
        expect.stringContaining('RCP-001'),
        { waitUntil: 'networkidle0' }
      );
      expect(mockPage.setContent).toHaveBeenCalledWith(
        expect.stringContaining('John Doe'),
        { waitUntil: 'networkidle0' }
      );
      expect(mockPage.setContent).toHaveBeenCalledWith(
        expect.stringContaining('Test Product'),
        { waitUntil: 'networkidle0' }
      );
    });

    it('should format currency correctly in HTML', async () => {
      const puppeteer = require('puppeteer');
      const mockPage = {
        setContent: jest.fn().mockResolvedValue(undefined),
        pdf: jest.fn().mockResolvedValue(undefined),
      };
      const mockBrowser = {
        newPage: jest.fn().mockResolvedValue(mockPage),
        close: jest.fn().mockResolvedValue(undefined),
      };
      puppeteer.launch.mockResolvedValue(mockBrowser);

      await service.generatePdfReceipt(mockReceiptData);

      const htmlContent = mockPage.setContent.mock.calls[0][0];
      expect(htmlContent).toContain('₦2,000'); // Unit price
      expect(htmlContent).toContain('₦2,160'); // Total
    });
  });

  describe('cleanupOldReceipts', () => {
    it('should clean up old receipt files', async () => {
      const oldDate = new Date();
      oldDate.setDate(oldDate.getDate() - 35); // 35 days old

      mockFs.readdir.mockResolvedValue(['receipt-001.pdf', 'receipt-002.pdf', 'other-file.txt'] as any);
      mockFs.stat.mockImplementation((filePath) => {
        if (filePath.toString().includes('receipt-001.pdf')) {
          return Promise.resolve({ mtime: oldDate } as any);
        }
        return Promise.resolve({ mtime: new Date() } as any);
      });

      await service.cleanupOldReceipts(30);

      expect(mockFs.unlink).toHaveBeenCalledTimes(1);
      expect(mockFs.unlink).toHaveBeenCalledWith(
        expect.stringContaining('receipt-001.pdf')
      );
    });

    it('should handle cleanup errors gracefully', async () => {
      mockFs.readdir.mockRejectedValue(new Error('Directory not found'));

      await expect(service.cleanupOldReceipts(30)).resolves.not.toThrow();
    });
  });

  describe('receiptExists', () => {
    it('should return true if receipt exists', async () => {
      mockFs.access.mockResolvedValue(undefined);

      const exists = await service.receiptExists('test-receipt.pdf');

      expect(exists).toBe(true);
      expect(mockFs.access).toHaveBeenCalledWith(
        expect.stringContaining('test-receipt.pdf')
      );
    });

    it('should return false if receipt does not exist', async () => {
      mockFs.access.mockRejectedValue(new Error('File not found'));

      const exists = await service.receiptExists('non-existent.pdf');

      expect(exists).toBe(false);
    });
  });

  describe('deleteReceipt', () => {
    it('should delete receipt successfully', async () => {
      mockFs.unlink.mockResolvedValue(undefined);

      const result = await service.deleteReceipt('test-receipt.pdf');

      expect(result).toBe(true);
      expect(mockFs.unlink).toHaveBeenCalledWith(
        expect.stringContaining('test-receipt.pdf')
      );
    });

    it('should handle deletion errors', async () => {
      mockFs.unlink.mockRejectedValue(new Error('Permission denied'));

      const result = await service.deleteReceipt('test-receipt.pdf');

      expect(result).toBe(false);
    });
  });

  describe('getReceiptPath', () => {
    it('should return correct file path', () => {
      const fileName = 'test-receipt.pdf';
      const filePath = service.getReceiptPath(fileName);

      expect(filePath).toContain('storage');
      expect(filePath).toContain('receipts');
      expect(filePath).toContain(fileName);
    });
  });
});