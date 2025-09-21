import { Test, TestingModule } from "@nestjs/testing";
import { ConversationService } from "./conversation.service";
import { ConversationFlowService } from "./conversation-flow.service";
import { ConversationSessionService } from "./conversation-session.service";
import { OrdersService } from "../../orders/orders.service";
import { ProductsService } from "../../products/products.service";
import { CustomersRepository } from "../../customers/customers.repository";
import {
  ConversationState,
  BotResponse,
  ConversationSession,
  CurrentOrder,
} from "../types/conversation.types";
import { ContextKey } from "../types/state-machine.types";

describe("ConversationService", () => {
  let service: ConversationService;
  let conversationFlowService: jest.Mocked<ConversationFlowService>;
  let sessionService: jest.Mocked<ConversationSessionService>;
  let ordersService: jest.Mocked<OrdersService>;
  let productsService: jest.Mocked<ProductsService>;
  let customersRepository: jest.Mocked<CustomersRepository>;

  const mockPhoneNumber = "+1234567890";
  const mockCustomerId = "customer-123";
  const mockOrderId = "order-123";

  beforeEach(async () => {
    const mockConversationFlowService = {
      processMessage: jest.fn(),
    };

    const mockSessionService = {
      getSession: jest.fn(),
      createSession: jest.fn(),
      updateState: jest.fn(),
      updateContext: jest.fn(),
      deleteSession: jest.fn(),
      getSessionStats: jest.fn(),
    };

    const mockOrdersService = {
      createOrder: jest.fn(),
      updateOrderStatus: jest.fn(),
    };

    const mockProductsService = {
      validateProductsForOrder: jest.fn(),
      getProductById: jest.fn(),
    };

    const mockCustomersRepository = {
      findByPhoneNumber: jest.fn(),
      create: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ConversationService,
        {
          provide: ConversationFlowService,
          useValue: mockConversationFlowService,
        },
        {
          provide: ConversationSessionService,
          useValue: mockSessionService,
        },
        {
          provide: OrdersService,
          useValue: mockOrdersService,
        },
        {
          provide: ProductsService,
          useValue: mockProductsService,
        },
        {
          provide: CustomersRepository,
          useValue: mockCustomersRepository,
        },
      ],
    }).compile();

    service = module.get<ConversationService>(ConversationService);
    conversationFlowService = module.get(ConversationFlowService);
    sessionService = module.get(ConversationSessionService);
    ordersService = module.get(OrdersService);
    productsService = module.get(ProductsService);
    customersRepository = module.get(CustomersRepository);
  });

  it("should be defined", () => {
    expect(service).toBeDefined();
  });

  describe("processConversation", () => {
    it("should process conversation for new session", async () => {
      const mockSession: ConversationSession = {
        phoneNumber: mockPhoneNumber,
        currentState: ConversationState.GREETING,
        lastActivity: new Date(),
        context: {},
      };

      const mockResponse: BotResponse = {
        message: "Hello! Welcome to our service.",
        nextState: ConversationState.BROWSING_PRODUCTS,
      };

      sessionService.getSession.mockResolvedValue(null);
      sessionService.createSession.mockResolvedValue(mockSession);
      conversationFlowService.processMessage.mockResolvedValue(mockResponse);
      sessionService.updateState.mockResolvedValue(true);

      const result = await service.processConversation(
        mockPhoneNumber,
        "hello",
      );

      expect(result.response.message).toBe("Hello! Welcome to our service.");
      expect(result.session.phoneNumber).toBe(mockPhoneNumber);
      expect(result.processingMetadata?.processingTime).toBeGreaterThanOrEqual(0);
      expect(sessionService.createSession).toHaveBeenCalledWith(mockPhoneNumber);
      expect(conversationFlowService.processMessage).toHaveBeenCalledWith(
        mockPhoneNumber,
        "hello",
      );
    });

    it("should process conversation for existing session", async () => {
      const mockSession: ConversationSession = {
        phoneNumber: mockPhoneNumber,
        currentState: ConversationState.BROWSING_PRODUCTS,
        lastActivity: new Date(),
        context: {},
      };

      const mockResponse: BotResponse = {
        message: "Here are our products...",
        context: { selectedCategory: "food" },
      };

      sessionService.getSession.mockResolvedValue(mockSession);
      conversationFlowService.processMessage.mockResolvedValue(mockResponse);
      sessionService.updateContext.mockResolvedValue(true);

      const result = await service.processConversation(
        mockPhoneNumber,
        "show me food items",
      );

      expect(result.response.message).toBe("Here are our products...");
      expect(result.session.phoneNumber).toBe(mockPhoneNumber);
      expect(sessionService.updateContext).toHaveBeenCalledWith(
        mockPhoneNumber,
        { selectedCategory: "food" },
      );
    });

    it("should handle state transitions", async () => {
      const mockSession: ConversationSession = {
        phoneNumber: mockPhoneNumber,
        currentState: ConversationState.BROWSING_PRODUCTS,
        lastActivity: new Date(),
        context: {},
      };

      const mockResponse: BotResponse = {
        message: "Added to cart!",
        nextState: ConversationState.ADDING_TO_CART,
        context: { cartItems: 1 },
      };

      sessionService.getSession.mockResolvedValue(mockSession);
      conversationFlowService.processMessage.mockResolvedValue(mockResponse);
      sessionService.updateState.mockResolvedValue(true);

      const result = await service.processConversation(
        mockPhoneNumber,
        "add pizza to cart",
      );

      expect(result.processingMetadata?.stateTransition).toEqual({
        from: ConversationState.BROWSING_PRODUCTS,
        to: ConversationState.ADDING_TO_CART,
      });
      expect(sessionService.updateState).toHaveBeenCalledWith(
        mockPhoneNumber,
        ConversationState.ADDING_TO_CART,
        { cartItems: 1 },
      );
    });

    it("should handle errors gracefully", async () => {
      sessionService.getSession.mockRejectedValue(new Error("Redis error"));

      const result = await service.processConversation(
        mockPhoneNumber,
        "hello",
      );

      expect(result.response.message).toContain("encountered an error");
      expect(result.session.currentState).toBe(ConversationState.GREETING);
    });
  });

  describe("handleOrderCreation", () => {
    it("should create order when transitioning to awaiting payment", async () => {
      const mockCurrentOrder: CurrentOrder = {
        items: [
          {
            productId: "product-1",
            quantity: 2,
            name: "Pizza",
            price: 15.99,
          },
        ],
        totalAmount: 31.98,
      };

      const mockSession: ConversationSession = {
        phoneNumber: mockPhoneNumber,
        currentState: ConversationState.AWAITING_PAYMENT,
        lastActivity: new Date(),
        context: {
          [ContextKey.CURRENT_ORDER]: mockCurrentOrder,
        },
      };

      const mockCustomer = {
        id: mockCustomerId,
        phoneNumber: mockPhoneNumber,
        name: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      const mockOrder = {
        id: mockOrderId,
        customerId: mockCustomerId,
        totalAmount: "31.98",
        items: [
          {
            productId: "product-1",
            quantity: 2,
            unitPrice: "15.99",
            totalPrice: "31.98",
          },
        ],
      };

      customersRepository.findByPhoneNumber.mockResolvedValue(mockCustomer);
      productsService.validateProductsForOrder.mockResolvedValue({
        valid: true,
        validProducts: [
          {
            product: {
              id: "product-1",
              name: "Pizza",
              price: "15.99",
              available: true,
              stockQuantity: 10,
            } as any,
            quantity: 2,
          },
        ],
        invalidProducts: [],
      });
      ordersService.createOrder.mockResolvedValue(mockOrder as any);
      sessionService.updateContext.mockResolvedValue(true);

      const mockResponse: BotResponse = {
        message: "Order confirmed!",
        nextState: ConversationState.AWAITING_PAYMENT,
      };

      sessionService.getSession.mockResolvedValue(mockSession);
      conversationFlowService.processMessage.mockResolvedValue(mockResponse);

      const result = await service.processConversation(
        mockPhoneNumber,
        "confirm order",
        { phoneNumber: mockPhoneNumber },
      );

      // The order creation happens in handleBusinessLogic when transitioning states
      // We need to simulate the state transition
      mockSession.currentState = ConversationState.REVIEWING_ORDER;
      const businessResult = await (service as any).handleBusinessLogic(
        { ...mockSession, currentState: ConversationState.AWAITING_PAYMENT },
        ConversationState.REVIEWING_ORDER,
        { phoneNumber: mockPhoneNumber },
      );

      expect(businessResult.orderCreated).toBe(mockOrderId);
      expect(businessResult.paymentRequired).toBe(true);
    });

    it("should handle order creation failure", async () => {
      const mockCurrentOrder: CurrentOrder = {
        items: [
          {
            productId: "product-1",
            quantity: 2,
            name: "Pizza",
            price: 15.99,
          },
        ],
        totalAmount: 31.98,
      };

      const mockSession: ConversationSession = {
        phoneNumber: mockPhoneNumber,
        currentState: ConversationState.AWAITING_PAYMENT,
        lastActivity: new Date(),
        context: {
          [ContextKey.CURRENT_ORDER]: mockCurrentOrder,
        },
      };

      customersRepository.findByPhoneNumber.mockResolvedValue(null);
      customersRepository.create.mockRejectedValue(new Error("Database error"));

      const businessResult = await (service as any).handleBusinessLogic(
        mockSession,
        ConversationState.REVIEWING_ORDER,
        { phoneNumber: mockPhoneNumber },
      );

      expect(businessResult.orderCreated).toBeUndefined();
    });
  });

  describe("handleOrderCompletion", () => {
    it("should complete order when payment is confirmed", async () => {
      const mockSession: ConversationSession = {
        phoneNumber: mockPhoneNumber,
        currentState: ConversationState.ORDER_COMPLETE,
        lastActivity: new Date(),
        context: {
          [ContextKey.ORDER_ID]: mockOrderId,
          [ContextKey.PAYMENT_REFERENCE]: "PAY-123",
        },
      };

      ordersService.updateOrderStatus.mockResolvedValue({} as any);
      sessionService.updateContext.mockResolvedValue(true);

      await (service as any).handleOrderCompletion(
        mockSession,
        { phoneNumber: mockPhoneNumber },
      );

      expect(ordersService.updateOrderStatus).toHaveBeenCalledWith(
        mockOrderId,
        "paid",
        "Payment confirmed via WhatsApp",
      );
      expect(mockSession.context[ContextKey.CURRENT_ORDER]).toBeUndefined();
      expect(mockSession.context[ContextKey.ORDER_ID]).toBeUndefined();
      expect(mockSession.context[ContextKey.PAYMENT_REFERENCE]).toBeUndefined();
    });
  });

  describe("ensureCustomerExists", () => {
    it("should return existing customer", async () => {
      const mockCustomer = {
        id: mockCustomerId,
        phoneNumber: mockPhoneNumber,
        name: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      customersRepository.findByPhoneNumber.mockResolvedValue(mockCustomer);

      const result = await (service as any).ensureCustomerExists(mockPhoneNumber);

      expect(result).toEqual(mockCustomer);
      expect(customersRepository.findByPhoneNumber).toHaveBeenCalledWith(
        mockPhoneNumber,
      );
      expect(customersRepository.create).not.toHaveBeenCalled();
    });

    it("should create new customer if not exists", async () => {
      const mockNewCustomer = {
        id: mockCustomerId,
        phoneNumber: mockPhoneNumber,
        name: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      customersRepository.findByPhoneNumber.mockResolvedValue(null);
      customersRepository.create.mockResolvedValue(mockNewCustomer);

      const result = await (service as any).ensureCustomerExists(mockPhoneNumber);

      expect(result).toEqual(mockNewCustomer);
      expect(customersRepository.create).toHaveBeenCalledWith({
        phoneNumber: mockPhoneNumber,
      });
    });

    it("should handle customer creation failure", async () => {
      customersRepository.findByPhoneNumber.mockResolvedValue(null);
      customersRepository.create.mockRejectedValue(new Error("Database error"));

      const result = await (service as any).ensureCustomerExists(mockPhoneNumber);

      expect(result).toBeNull();
    });
  });

  describe("resetConversation", () => {
    it("should reset conversation successfully", async () => {
      const mockNewSession: ConversationSession = {
        phoneNumber: mockPhoneNumber,
        currentState: ConversationState.GREETING,
        lastActivity: new Date(),
        context: {},
      };

      sessionService.deleteSession.mockResolvedValue(true);
      sessionService.createSession.mockResolvedValue(mockNewSession);

      const result = await service.resetConversation(mockPhoneNumber);

      expect(result).toBe(true);
      expect(sessionService.deleteSession).toHaveBeenCalledWith(mockPhoneNumber);
      expect(sessionService.createSession).toHaveBeenCalledWith(mockPhoneNumber);
    });

    it("should handle reset failure", async () => {
      sessionService.deleteSession.mockRejectedValue(new Error("Redis error"));

      const result = await service.resetConversation(mockPhoneNumber);

      expect(result).toBe(false);
    });
  });

  describe("getConversationStats", () => {
    it("should return conversation statistics", async () => {
      const mockStats = {
        totalSessions: 5,
        sessionsByState: {
          [ConversationState.GREETING]: 2,
          [ConversationState.COLLECTING_NAME]: 0,
          [ConversationState.MAIN_MENU]: 0,
          [ConversationState.BROWSING_PRODUCTS]: 1,
          [ConversationState.ADDING_TO_CART]: 1,
          [ConversationState.COLLECTING_QUANTITY]: 0,
          [ConversationState.REVIEWING_ORDER]: 1,
          [ConversationState.AWAITING_PAYMENT]: 0,
          [ConversationState.PAYMENT_CONFIRMATION]: 0,
          [ConversationState.ORDER_COMPLETE]: 0,
        },
      };

      sessionService.getSessionStats.mockResolvedValue(mockStats);

      const result = await service.getConversationStats();

      expect(result).toEqual(mockStats);
      expect(sessionService.getSessionStats).toHaveBeenCalled();
    });
  });
});