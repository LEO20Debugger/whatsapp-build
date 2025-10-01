import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { ReceiptVerificationService, ExpectedPayment } from './receipt-verification.service';

describe('ReceiptVerificationService', () => {
  let service: ReceiptVerificationService;
  let configService: jest.Mocked<ConfigService>;

  const mockExpectedPayment: ExpectedPayment = {
    reference: 'PAY-O123-ABC123-XYZ456',
    amount: 5000,
    accountNumber: '1234567890',
    bankName: 'Main Bank',
  };

  beforeEach(async () => {
    const mockConfigService = {
      get: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReceiptVerificationService,
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
      ],
    }).compile();

    service = module.get<ReceiptVerificationService>(ReceiptVerificationService);
    configService = module.get(ConfigService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('verifyReceiptImage', () => {
    it('should verify a valid receipt with high confidence', async () => {
      // Arrange
      const mockImageBuffer = Buffer.from('mock image data');
      configService.get.mockReturnValue('tesseract'); // Use tesseract OCR

      // Mock a successful receipt text
      const mockReceiptText = `
        TRANSFER SUCCESSFUL
        Bank: Main Bank
        Account: 1234567890
        Amount: 5000.00
        Reference: PAY-O123-ABC123-XYZ456
        Status: Completed
        Date: 2025-01-10
      `;

      // Mock the OCR extraction to return our test text
      jest.spyOn(service as any, 'extractTextFromImage').mockResolvedValue({
        text: mockReceiptText,
        confidence: 95,
      });

      // Act
      const result = await service.verifyReceiptImage(mockImageBuffer, mockExpectedPayment);

      // Assert
      expect(result.verified).toBe(true);
      expect(result.confidence).toBeGreaterThanOrEqual(70);
      expect(result.details.referenceFound).toBe(true);
      expect(result.details.amountFound).toBe(true);
      expect(result.details.accountFound).toBe(true);
      expect(result.details.successFound).toBe(true);
      expect(result.details.extractedText).toBe(mockReceiptText);
    });

    it('should reject receipt with missing payment reference', async () => {
      // Arrange
      const mockImageBuffer = Buffer.from('mock image data');
      configService.get.mockReturnValue('tesseract');

      const mockReceiptText = `
        TRANSFER SUCCESSFUL
        Bank: Main Bank
        Account: 1234567890
        Amount: 5000.00
        Reference: WRONG-REFERENCE-123
        Status: Completed
      `;

      jest.spyOn(service as any, 'extractTextFromImage').mockResolvedValue({
        text: mockReceiptText,
        confidence: 95,
      });

      // Act
      const result = await service.verifyReceiptImage(mockImageBuffer, mockExpectedPayment);

      // Assert
      expect(result.verified).toBe(false);
      expect(result.details.referenceFound).toBe(false);
      expect(result.details.issues).toContain('Payment reference "PAY-O123-ABC123-XYZ456" not found');
    });

    it('should reject receipt with wrong amount', async () => {
      // Arrange
      const mockImageBuffer = Buffer.from('mock image data');
      configService.get.mockReturnValue('tesseract');

      const mockReceiptText = `
        TRANSFER SUCCESSFUL
        Bank: Main Bank
        Account: 1234567890
        Amount: 3000.00
        Reference: PAY-O123-ABC123-XYZ456
        Status: Completed
      `;

      jest.spyOn(service as any, 'extractTextFromImage').mockResolvedValue({
        text: mockReceiptText,
        confidence: 95,
      });

      // Act
      const result = await service.verifyReceiptImage(mockImageBuffer, mockExpectedPayment);

      // Assert
      expect(result.verified).toBe(false);
      expect(result.details.amountFound).toBe(false);
      expect(result.details.issues).toContain('Amount "5000" not found');
    });

    it('should reject receipt showing transaction failure', async () => {
      // Arrange
      const mockImageBuffer = Buffer.from('mock image data');
      configService.get.mockReturnValue('tesseract');

      const mockReceiptText = `
        TRANSFER FAILED
        Bank: Main Bank
        Account: 1234567890
        Amount: 5000.00
        Reference: PAY-O123-ABC123-XYZ456
        Status: Failed - Insufficient funds
      `;

      jest.spyOn(service as any, 'extractTextFromImage').mockResolvedValue({
        text: mockReceiptText,
        confidence: 95,
      });

      // Act
      const result = await service.verifyReceiptImage(mockImageBuffer, mockExpectedPayment);

      // Assert
      expect(result.verified).toBe(false);
      expect(result.confidence).toBeLessThan(70);
      expect(result.details.issues).toContain('Receipt shows transaction failure');
    });

    it('should handle OCR extraction failure gracefully', async () => {
      // Arrange
      const mockImageBuffer = Buffer.from('mock image data');
      configService.get.mockReturnValue('tesseract');

      jest.spyOn(service as any, 'extractTextFromImage').mockResolvedValue({
        text: '',
        confidence: 0,
      });

      // Act
      const result = await service.verifyReceiptImage(mockImageBuffer, mockExpectedPayment);

      // Assert
      expect(result.verified).toBe(false);
      expect(result.confidence).toBe(0);
      expect(result.details.issues).toContain('No text could be extracted from the image');
    });

    it('should handle various amount formats', async () => {
      // Arrange
      const mockImageBuffer = Buffer.from('mock image data');
      configService.get.mockReturnValue('tesseract');

      const testCases = [
        '₦5,000.00',
        'NGN 5000',
        '5000.00',
        '5,000',
        'Amount: ₦5000',
      ];

      for (const amountFormat of testCases) {
        const mockReceiptText = `
          TRANSFER SUCCESSFUL
          Bank: Main Bank
          Account: 1234567890
          Amount: ${amountFormat}
          Reference: PAY-O123-ABC123-XYZ456
          Status: Completed
        `;

        jest.spyOn(service as any, 'extractTextFromImage').mockResolvedValue({
          text: mockReceiptText,
          confidence: 95,
        });

        // Act
        const result = await service.verifyReceiptImage(mockImageBuffer, mockExpectedPayment);

        // Assert
        expect(result.details.amountFound).toBe(true);
      }
    });

    it('should format verification issues correctly', () => {
      // Arrange
      const mockVerification = {
        verified: false,
        confidence: 30,
        details: {
          referenceFound: false,
          amountFound: false,
          accountFound: true,
          successFound: true,
          extractedText: 'mock text',
          issues: [
            'Payment reference not found',
            'Amount not found',
            'Receipt quality too low',
          ],
        },
      };

      // Act
      const formatted = service.formatVerificationIssues(mockVerification);

      // Assert
      expect(formatted).toContain('1. Payment reference not found');
      expect(formatted).toContain('2. Amount not found');
      expect(formatted).toContain('3. Receipt quality too low');
    });

    it('should handle successful verification with no issues', () => {
      // Arrange
      const mockVerification = {
        verified: true,
        confidence: 90,
        details: {
          referenceFound: true,
          amountFound: true,
          accountFound: true,
          successFound: true,
          extractedText: 'mock text',
        },
      };

      // Act
      const formatted = service.formatVerificationIssues(mockVerification);

      // Assert
      expect(formatted).toBe('Receipt verification completed successfully.');
    });
  });

  describe('OCR Provider Selection', () => {
    it('should use tesseract by default', async () => {
      // Arrange
      configService.get.mockReturnValue(undefined);
      const mockImageBuffer = Buffer.from('mock image data');

      // Act
      const extractSpy = jest.spyOn(service as any, 'extractWithTesseract').mockResolvedValue({
        text: 'mock text',
        confidence: 85,
      });

      await (service as any).extractTextFromImage(mockImageBuffer);

      // Assert
      expect(extractSpy).toHaveBeenCalledWith(mockImageBuffer);
    });

    it('should use specified OCR provider', async () => {
      // Arrange
      configService.get.mockReturnValue('google');
      const mockImageBuffer = Buffer.from('mock image data');

      // Act
      const extractSpy = jest.spyOn(service as any, 'extractWithGoogleVision').mockResolvedValue({
        text: 'mock text',
        confidence: 95,
      });

      await (service as any).extractTextFromImage(mockImageBuffer);

      // Assert
      expect(extractSpy).toHaveBeenCalledWith(mockImageBuffer);
    });
  });
});