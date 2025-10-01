import { Test, TestingModule } from '@nestjs/testing';
import { PaymentsService } from './payments.service';
import { PaymentsRepository } from './payments.repository';
import { OrdersRepository } from '../orders/orders.repository';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { PaymentStatus, PaymentMethod } from '../../database/types';

describe('PaymentsService', () => {
  let service: PaymentsService;
  let paymentsRepository: jest.Mocked<PaymentsRepository>;
  let ordersRepository: jest.Mocked<OrdersRepository>;

  const mockPayment = {
    id: 'payment-123',
    createdAt: new Date('2024-01-01T10:00:00Z'),
    updatedAt: new Date('2024-01-01T10:00:00Z'),
    status: 'pending' as PaymentStatus,
    paymentReference: 'PAY-123',
    orderId: 'order-123',
    amount: '1000',
    paymentMethod: 'bank_transfer' as PaymentMethod,
    externalTransactionId: '',
    failureReason: '',
    verifiedAt: null,
  };

  const mockOrder = {
    id: 'order-123',
    createdAt: new Date('2024-01-01T10:00:00Z'),
    updatedAt: new Date('2024-01-01T10:00:00Z'),
    status: 'confirmed' as const,
    customerId: 'customer-123',
    totalAmount: '1000',
    subtotalAmount: '920',
    taxAmount: '80',
    paymentReference: 'PAY-123',
    notes: '',
  };

  beforeEach(async () => {
    const mockPaymentsRepository = {
      create: jest.fn(),
      findById: jest.fn(),
      findByPaymentReference: jest.fn(),
      updateStatus: jest.fn(),
      markAsFailed: jest.fn(),
      findByOrderId: jest.fn(),
      paymentReferenceExists: jest.fn(),
      verifyPayment: jest.fn(),
    };

    const mockOrdersRepository = {
      findById: jest.fn(),
      findByIdWithItems: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaymentsService,
        {
          provide: PaymentsRepository,
          useValue: mockPaymentsRepository,
        },
        {
          provide: OrdersRepository,
          useValue: mockOrdersRepository,
        },
      ],
    }).compile();

    service = module.get<PaymentsService>(PaymentsService);
    paymentsRepository = module.get(PaymentsRepository);
    ordersRepository = module.get(OrdersRepository);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('createPayment', () => {
    it('should create a new payment successfully', async () => {
      // Arrange
      const createRequest = {
        orderId: 'order-123',
        paymentMethod: 'bank_transfer' as PaymentMethod,
      };

      ordersRepository.findById.mockResolvedValue(mockOrder);
      paymentsRepository.findByOrderId.mockResolvedValue([]);
      paymentsRepository.create.mockResolvedValue(mockPayment);

      // Act
      const result = await service.createPayment(createRequest);

      // Assert
      expect(result).toEqual(mockPayment);
      expect(paymentsRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          orderId: 'order-123',
          paymentMethod: 'bank_transfer',
          amount: '1000',
        })
      );
    });

    it('should throw NotFoundException for non-existent order', async () => {
      // Arrange
      const createRequest = {
        orderId: 'nonexistent-order',
        paymentMethod: 'bank_transfer' as PaymentMethod,
      };

      ordersRepository.findById.mockResolvedValue(null);

      // Act & Assert
      await expect(service.createPayment(createRequest)).rejects.toThrow(
        NotFoundException
      );
    });
  });

  describe('generatePaymentInstructions', () => {
    it('should generate payment instructions for bank transfer', async () => {
      // Arrange
      ordersRepository.findById.mockResolvedValue(mockOrder);
      paymentsRepository.paymentReferenceExists.mockResolvedValue(false);

      // Act
      const result = await service.generatePaymentInstructions(
        'order-123',
        'bank_transfer'
      );

      // Assert
      expect(result).toEqual(
        expect.objectContaining({
          paymentReference: expect.any(String),
          amount: 1000,
          paymentMethod: 'bank_transfer',
          accountDetails: expect.objectContaining({
            bankTransfer: expect.objectContaining({
              accountName: expect.any(String),
              accountNumber: expect.any(String),
              bankName: expect.any(String),
            }),
          }),
          expiresAt: expect.any(Date),
          instructions: expect.any(Array),
        })
      );
    });

    it('should generate payment instructions for card payment', async () => {
      // Arrange
      ordersRepository.findById.mockResolvedValue(mockOrder);
      paymentsRepository.paymentReferenceExists.mockResolvedValue(false);

      // Act
      const result = await service.generatePaymentInstructions(
        'order-123',
        'card'
      );

      // Assert
      expect(result).toEqual(
        expect.objectContaining({
          paymentReference: expect.any(String),
          amount: 1000,
          paymentMethod: 'card',
          accountDetails: expect.objectContaining({
            card: expect.objectContaining({
              merchantId: expect.any(String),
              processorUrl: expect.any(String),
            }),
          }),
          expiresAt: expect.any(Date),
          instructions: expect.any(Array),
        })
      );
    });
  });

  describe('generatePaymentReference', () => {
    it('should generate unique payment reference', async () => {
      // Arrange
      paymentsRepository.paymentReferenceExists.mockResolvedValue(false);

      // Act
      const result = await service.generatePaymentReference('order-123');

      // Assert
      expect(result).toMatch(/^PAY-[A-Z0-9]+-[A-Z0-9]+-[A-Z0-9]+$/);
    });
  });

  describe('verifyPayment', () => {
    it('should verify payment successfully', async () => {
      // Arrange
      const verificationRequest = {
        paymentReference: 'PAY-123',
        verificationData: {
          confirmedAt: new Date(),
          phoneNumber: '+2348012345678',
        },
      };

      const verifiedPayment = {
        ...mockPayment,
        status: 'verified' as PaymentStatus,
        verifiedAt: new Date(),
      };

      paymentsRepository.findByPaymentReference.mockResolvedValue(mockPayment);
      paymentsRepository.verifyPayment.mockResolvedValue(verifiedPayment);

      // Act
      const result = await service.verifyPayment(verificationRequest);

      // Assert
      expect(result.success).toBe(true);
      expect(result.payment).toEqual(verifiedPayment);
      expect(paymentsRepository.verifyPayment).toHaveBeenCalledWith(
        mockPayment.id,
        ''
      );
    });

    it('should fail verification for non-existent payment', async () => {
      // Arrange
      const verificationRequest = {
        paymentReference: 'NONEXISTENT-PAY',
        verificationData: {
          confirmedAt: new Date(),
          phoneNumber: '+2348012345678',
        },
      };

      paymentsRepository.findByPaymentReference.mockResolvedValue(null);

      // Act
      const result = await service.verifyPayment(verificationRequest);

      // Assert
      expect(result.success).toBe(false);
      expect(result.message).toContain('Payment not found');
    });

    it('should fail verification for already verified payment', async () => {
      // Arrange
      const verificationRequest = {
        paymentReference: 'PAY-123',
        verificationData: {
          confirmedAt: new Date(),
          phoneNumber: '+2348012345678',
        },
      };

      const alreadyVerifiedPayment = {
        ...mockPayment,
        status: 'verified' as PaymentStatus,
        verifiedAt: new Date(),
      };

      paymentsRepository.findByPaymentReference.mockResolvedValue(alreadyVerifiedPayment);

      // Act
      const result = await service.verifyPayment(verificationRequest);

      // Assert
      expect(result.success).toBe(false);
      expect(result.message).toContain('already verified');
    });
  });

  describe('generateReceipt', () => {
    it('should generate receipt successfully', async () => {
      // Arrange
      const mockCustomer = {
        id: 'customer-123',
        phoneNumber: '+2348012345678',
        name: 'John Doe',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const mockOrderWithItems = {
        ...mockOrder,
        items: [
          {
            id: 'item-1',
            orderId: 'order-123',
            productId: 'product-1',
            productName: 'Test Product',
            quantity: 2,
            unitPrice: '500',
            totalPrice: '1000',
          },
        ],
        customer: mockCustomer,
        payments: [],
      };

      const verifiedPayment = {
        ...mockPayment,
        status: 'verified' as PaymentStatus,
        verifiedAt: new Date(),
      };

      paymentsRepository.findById.mockResolvedValue(verifiedPayment);
      ordersRepository.findByIdWithItems.mockResolvedValue(mockOrderWithItems);

      // Act
      const result = await service.generateReceipt(mockPayment.id);

      // Assert
      expect(result).toEqual(
        expect.objectContaining({
          receiptId: expect.any(String),
          receiptNumber: expect.any(String),
          generatedAt: expect.any(Date),
          paymentId: mockPayment.id,
          orderId: mockOrder.id,
          customerInfo: expect.objectContaining({
            phoneNumber: '+2348012345678',
            name: 'John Doe',
          }),
          orderDetails: expect.objectContaining({
            items: expect.any(Array),
            total: 1000,
          }),
          paymentDetails: expect.objectContaining({
            method: 'bank_transfer',
            reference: 'PAY-123',
            verifiedAt: expect.any(Date),
          }),
        })
      );
    });

    it('should throw NotFoundException for non-existent payment', async () => {
      // Arrange
      paymentsRepository.findById.mockResolvedValue(null);

      // Act & Assert
      await expect(service.generateReceipt('nonexistent-payment')).rejects.toThrow(
        NotFoundException
      );
    });
  });

  describe('getReceiptByPaymentId', () => {
    it('should return null when no receipt found for payment ID', async () => {
      // Act
      const result = await service.getReceiptByPaymentId('nonexistent-payment');

      // Assert
      expect(result).toBeNull();
    });
  });
});