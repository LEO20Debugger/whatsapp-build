import { Test, TestingModule } from '@nestjs/testing';
import { ConversationService } from './conversation.service';
import { OrderFlowService } from './order-flow.service';
import { ConversationFlowService } from './conversation-flow.service';
import { ConversationSessionService } from './conversation-session.service';
import { OrdersService } from '../../orders/orders.service';
import { ProductsService } from '../../products/products.service';
import { CustomersRepository } from '../../customers/customers.repository';
import { ConversationState, CurrentOrder, OrderItem } from '../types/conversation.types';
import { ContextKey } from '../types/state-machine.types';

describe('Order Flow Integration', () => {
  let conversationService: ConversationService;
  let orderFlowService: OrderFlowService;
  let conversationFlowService: ConversationFlowService;
  let sessionService: ConversationSessionService;
  let ordersService: OrdersService;
  let productsService: ProductsService;
  let customersRepository: CustomersRepository;

  const mockPhoneNumber = '+1234567890';
  const mockCustomerId = 'customer-123';
  const mockOrderId = 'order-456';

  const mockProducts = [
    {
      id: 'product-1',
      name: 'Pizza Margherita',
      description: 'Classic margherita pizza',
      price: '25.99',
      available: true,
      category: 'Pizza',
      stockQuantity: 10,
      sku: 'PIZZA-001',
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    {
      id: 'product-2',
      name: 'Burger Deluxe',
      description: 'Deluxe burger with all toppings',
      price: '18.50',
      available: true,
      category: 'Burgers',
      stockQuantity: 5,
      sku: 'BURGER-001',
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    {
      id: 'product-3',
      name: 'Pasta Carbonara',
      description: 'Creamy carbonara pasta',
      price: '22.00',
      available: false,
      category: 'Pasta',
      stockQuantity: 0,
      sku: 'PASTA-001',
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  ];

  const mockCustomer = {
    id: mockCustomerId,
    phoneNumber: mockPhoneNumber,
    name: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ConversationService,
        OrderFlowService,
        {
          provide: ConversationFlowService,
          useValue: {
            processMessage: jest.fn(),
          },
        },
        {
          provide: ConversationSessionService,
          useValue: {
            getSession: jest.fn(),
            createSession: jest.fn(),
            updateState: jest.fn(),
            updateContext: jest.fn(),
            deleteSession: jest.fn(),
            getSessionStats: jest.fn(),
          },
        },
        {
          provide: OrdersService,
          useValue: {
            createOrder: jest.fn(),
            updateOrderStatus: jest.fn(),
            getOrderById: jest.fn(),
            calculateOrderTotals: jest.fn(),
          },
        },
        {
          provide: ProductsService,
          useValue: {
            getProductById: jest.fn(),
            isProductAvailable: jest.fn(),
            getAvailableProducts: jest.fn(),
          },
        },
        {
          provide: CustomersRepository,
          useValue: {
            findByPhoneNumber: jest.fn(),
            create: jest.fn(),
          },
        },
      ],
    }).compile();

    conversationService = module.get<ConversationService>(ConversationService);
    orderFlowService = module.get<OrderFlowService>(OrderFlowService);
    conversationFlowService = module.get<ConversationFlowService>(ConversationFlowService);
    sessionService = module.get<ConversationSessionService>(ConversationSessionService);
    ordersService = module.get<OrdersService>(OrdersService);
    productsService = module.get<ProductsService>(ProductsService);
    customersRepository = module.get<CustomersRepository>(CustomersRepository);
  });

  describe('Cart Management Integration', () => {
    it('should add item to cart successfully', async () => {
      // Arrange
      const mockSession = {
        phoneNumber: mockPhoneNumber,
        currentState: ConversationState.ADDING_TO_CART,
        lastActivity: new Date(),
        context: {},
      };

      jest.spyOn(sessionService, 'getSession').mockResolvedValue(mockSession);
      jest.spyOn(productsService, 'getProductById').mockResolvedValue(mockProducts[0]);
      jest.spyOn(productsService, 'isProductAvailable').mockResolvedValue(true);
      jest.spyOn(sessionService, 'updateContext').mockResolvedValue(undefined);

      // Act
      const result = await conversationService.addToCart(mockPhoneNumber, 'product-1', 2);

      // Assert
      expect(result.success).toBe(true);
      expect(result.message).toContain('Item added to cart successfully');
      expect(result.cartSummary).toBeDefined();
      expect(result.cartSummary.items).toHaveLength(1);
      expect(result.cartSummary.items[0].quantity).toBe(2);
      expect(result.cartSummary.items[0].productName).toBe('Pizza Margherita');
    });

    it('should handle adding item when product is unavailable', async () => {
      // Arrange
      const mockSession = {
        phoneNumber: mockPhoneNumber,
        currentState: ConversationState.ADDING_TO_CART,
        lastActivity: new Date(),
        context: {},
      };

      jest.spyOn(sessionService, 'getSession').mockResolvedValue(mockSession);
      jest.spyOn(productsService, 'getProductById').mockResolvedValue(mockProducts[2]); // Unavailable product
      jest.spyOn(productsService, 'isProductAvailable').mockResolvedValue(false);

      // Act
      const result = await conversationService.addToCart(mockPhoneNumber, 'product-3', 1);

      // Assert
      expect(result.success).toBe(false);
      expect(result.message).toContain('currently not available');
    });

    it('should remove item from cart successfully', async () => {
      // Arrange
      const existingOrder: CurrentOrder = {
        items: [
          {
            productId: 'product-1',
            name: 'Pizza Margherita',
            quantity: 2,
            price: 25.99,
          },
          {
            productId: 'product-2',
            name: 'Burger Deluxe',
            quantity: 1,
            price: 18.50,
          },
        ],
        totalAmount: 70.48,
      };

      const mockSession = {
        phoneNumber: mockPhoneNumber,
        currentState: ConversationState.ADDING_TO_CART,
        lastActivity: new Date(),
        context: {
          [ContextKey.CURRENT_ORDER]: existingOrder,
        },
      };

      jest.spyOn(sessionService, 'getSession').mockResolvedValue(mockSession);
      jest.spyOn(sessionService, 'updateContext').mockResolvedValue(undefined);

      // Act
      const result = await conversationService.removeFromCart(mockPhoneNumber, 'product-1');

      // Assert
      expect(result.success).toBe(true);
      expect(result.message).toContain('Item removed from cart successfully');
      expect(result.cartSummary.items).toHaveLength(1);
      expect(result.cartSummary.items[0].productName).toBe('Burger Deluxe');
    });

    it('should clear cart successfully', async () => {
      // Arrange
      const existingOrder: CurrentOrder = {
        items: [
          {
            productId: 'product-1',
            name: 'Pizza Margherita',
            quantity: 2,
            price: 25.99,
          },
        ],
        totalAmount: 51.98,
      };

      const mockSession = {
        phoneNumber: mockPhoneNumber,
        currentState: ConversationState.ADDING_TO_CART,
        lastActivity: new Date(),
        context: {
          [ContextKey.CURRENT_ORDER]: existingOrder,
        },
      };

      jest.spyOn(sessionService, 'getSession').mockResolvedValue(mockSession);
      jest.spyOn(sessionService, 'updateContext').mockResolvedValue(undefined);

      // Act
      const result = await conversationService.clearCart(mockPhoneNumber);

      // Assert
      expect(result.success).toBe(true);
      expect(result.message).toContain('Cart cleared successfully');
    });
  });

  describe('Order Creation Integration', () => {
    it('should create order from cart successfully', async () => {
      // Arrange
      const cartItems: OrderItem[] = [
        {
          productId: 'product-1',
          name: 'Pizza Margherita',
          quantity: 2,
          price: 25.99,
        },
        {
          productId: 'product-2',
          name: 'Burger Deluxe',
          quantity: 1,
          price: 18.50,
        },
      ];

      const mockSession = {
        phoneNumber: mockPhoneNumber,
        currentState: ConversationState.REVIEWING_ORDER,
        lastActivity: new Date(),
        context: {
          [ContextKey.CURRENT_ORDER]: {
            items: cartItems,
            totalAmount: 70.48,
          },
        },
      };

      const mockOrderWithItems = {
        id: mockOrderId,
        customerId: mockCustomerId,
        status: 'pending' as const,
        subtotalAmount: '70.48',
        taxAmount: '7.05',
        totalAmount: '77.53',
        paymentReference: null,
        notes: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        items: cartItems.map(item => ({
          id: `item-${item.productId}`,
          orderId: mockOrderId,
          productId: item.productId,
          productName: item.name,
          quantity: item.quantity,
          unitPrice: item.price.toString(),
          totalPrice: (item.price * item.quantity).toString(),
        })),
        customer: mockCustomer,
        payments: [],
      };

      jest.spyOn(sessionService, 'getSession').mockResolvedValue(mockSession);
      jest.spyOn(customersRepository, 'findByPhoneNumber').mockResolvedValue(mockCustomer);
      jest.spyOn(productsService, 'getProductById')
        .mockResolvedValueOnce(mockProducts[0])
        .mockResolvedValueOnce(mockProducts[1]);
      jest.spyOn(productsService, 'isProductAvailable').mockResolvedValue(true);
      jest.spyOn(ordersService, 'createOrder').mockResolvedValue(mockOrderWithItems);
      jest.spyOn(sessionService, 'updateContext').mockResolvedValue(undefined);

      // Act
      const result = await orderFlowService.createOrderFromCart(mockSession, mockCustomerId);

      // Assert
      expect(result.success).toBe(true);
      expect(result.orderId).toBe(mockOrderId);
      expect(ordersService.createOrder).toHaveBeenCalledWith({
        customerId: mockCustomerId,
        items: [
          { productId: 'product-1', quantity: 2 },
          { productId: 'product-2', quantity: 1 },
        ],
        notes: `Order placed via WhatsApp from ${mockPhoneNumber}`,
      });
    });

    it('should handle order creation failure due to validation errors', async () => {
      // Arrange
      const cartItems: OrderItem[] = [
        {
          productId: 'product-3', // Unavailable product
          name: 'Pasta Carbonara',
          quantity: 1,
          price: 22.00,
        },
      ];

      const mockSession = {
        phoneNumber: mockPhoneNumber,
        currentState: ConversationState.REVIEWING_ORDER,
        lastActivity: new Date(),
        context: {
          [ContextKey.CURRENT_ORDER]: {
            items: cartItems,
            totalAmount: 22.00,
          },
        },
      };

      jest.spyOn(sessionService, 'getSession').mockResolvedValue(mockSession);
      jest.spyOn(productsService, 'getProductById').mockResolvedValue(mockProducts[2]); // Unavailable
      jest.spyOn(productsService, 'isProductAvailable').mockResolvedValue(false);

      // Act
      const result = await orderFlowService.createOrderFromCart(mockSession, mockCustomerId);

      // Assert
      expect(result.success).toBe(false);
      expect(result.error).toContain('Order validation failed');
    });
  });

  describe('Cart Validation Integration', () => {
    it('should validate cart before order creation', async () => {
      // Arrange
      const cartItems: OrderItem[] = [
        {
          productId: 'product-1',
          name: 'Pizza Margherita',
          quantity: 2,
          price: 25.99,
        },
        {
          productId: 'product-2',
          name: 'Burger Deluxe',
          quantity: 1,
          price: 18.50,
        },
      ];

      const mockSession = {
        phoneNumber: mockPhoneNumber,
        currentState: ConversationState.REVIEWING_ORDER,
        lastActivity: new Date(),
        context: {
          [ContextKey.CURRENT_ORDER]: {
            items: cartItems,
            totalAmount: 70.48,
          },
        },
      };

      jest.spyOn(sessionService, 'getSession').mockResolvedValue(mockSession);
      jest.spyOn(productsService, 'getProductById')
        .mockResolvedValueOnce(mockProducts[0])
        .mockResolvedValueOnce(mockProducts[1]);
      jest.spyOn(productsService, 'isProductAvailable').mockResolvedValue(true);

      // Act
      const result = await conversationService.validateCartForOrder(mockPhoneNumber);

      // Assert
      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should detect validation errors in cart', async () => {
      // Arrange
      const cartItems: OrderItem[] = [
        {
          productId: 'product-1',
          name: 'Pizza Margherita',
          quantity: 15, // Exceeds stock
          price: 25.99,
        },
        {
          productId: 'product-3',
          name: 'Pasta Carbonara',
          quantity: 1,
          price: 22.00,
        },
      ];

      const mockSession = {
        phoneNumber: mockPhoneNumber,
        currentState: ConversationState.REVIEWING_ORDER,
        lastActivity: new Date(),
        context: {
          [ContextKey.CURRENT_ORDER]: {
            items: cartItems,
            totalAmount: 411.85,
          },
        },
      };

      jest.spyOn(sessionService, 'getSession').mockResolvedValue(mockSession);
      jest.spyOn(productsService, 'getProductById')
        .mockResolvedValueOnce(mockProducts[0]) // Available but insufficient stock
        .mockResolvedValueOnce(mockProducts[2]); // Unavailable
      jest.spyOn(productsService, 'isProductAvailable')
        .mockResolvedValueOnce(false) // Insufficient stock
        .mockResolvedValueOnce(false); // Unavailable

      // Act
      const result = await conversationService.validateCartForOrder(mockPhoneNumber);

      // Assert
      expect(result.isValid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors.some(error => error.includes('no longer available'))).toBe(true);
      expect(result.errors.some(error => error.includes('Insufficient stock'))).toBe(true);
    });
  });

  describe('Error Handling Integration', () => {
    it('should handle session not found gracefully', async () => {
      // Arrange
      jest.spyOn(sessionService, 'getSession').mockResolvedValue(null);

      // Act
      const result = await conversationService.addToCart(mockPhoneNumber, 'product-1', 1);

      // Assert
      expect(result.success).toBe(false);
      expect(result.message).toContain('Session not found');
    });

    it('should handle product service errors gracefully', async () => {
      // Arrange
      const mockSession = {
        phoneNumber: mockPhoneNumber,
        currentState: ConversationState.ADDING_TO_CART,
        lastActivity: new Date(),
        context: {},
      };

      jest.spyOn(sessionService, 'getSession').mockResolvedValue(mockSession);
      jest.spyOn(productsService, 'getProductById').mockRejectedValue(new Error('Product service error'));

      // Act
      const result = await conversationService.addToCart(mockPhoneNumber, 'product-1', 1);

      // Assert
      expect(result.success).toBe(false);
      expect(result.message).toContain('Failed to add item to cart');
    });
  });

  describe('Cart Summary Integration', () => {
    it('should generate correct cart summary with tax calculations', async () => {
      // Arrange
      const cartItems: OrderItem[] = [
        {
          productId: 'product-1',
          name: 'Pizza Margherita',
          quantity: 2,
          price: 25.99,
        },
        {
          productId: 'product-2',
          name: 'Burger Deluxe',
          quantity: 1,
          price: 18.50,
        },
      ];

      const mockSession = {
        phoneNumber: mockPhoneNumber,
        currentState: ConversationState.ADDING_TO_CART,
        lastActivity: new Date(),
        context: {
          [ContextKey.CURRENT_ORDER]: {
            items: cartItems,
            totalAmount: 70.48,
          },
        },
      };

      jest.spyOn(sessionService, 'getSession').mockResolvedValue(mockSession);

      // Act
      const result = await conversationService.getCartSummary(mockPhoneNumber);

      // Assert
      expect(result.success).toBe(true);
      expect(result.cartSummary).toBeDefined();
      expect(result.cartSummary.items).toHaveLength(2);
      expect(result.cartSummary.itemCount).toBe(3); // 2 + 1
      expect(result.cartSummary.subtotal).toBe(70.48);
      expect(result.cartSummary.tax).toBe(7.05); // 10% of subtotal
      expect(result.cartSummary.total).toBe(77.53); // subtotal + tax
      expect(result.formattedSummary).toContain('Pizza Margherita');
      expect(result.formattedSummary).toContain('Burger Deluxe');
    });

    it('should handle empty cart summary', async () => {
      // Arrange
      const mockSession = {
        phoneNumber: mockPhoneNumber,
        currentState: ConversationState.GREETING,
        lastActivity: new Date(),
        context: {},
      };

      jest.spyOn(sessionService, 'getSession').mockResolvedValue(mockSession);

      // Act
      const result = await conversationService.getCartSummary(mockPhoneNumber);

      // Assert
      expect(result.success).toBe(true);
      expect(result.cartSummary.items).toHaveLength(0);
      expect(result.cartSummary.itemCount).toBe(0);
      expect(result.cartSummary.total).toBe(0);
      expect(result.formattedSummary).toContain('cart is empty');
    });
  });
});