import { Test, TestingModule } from '@nestjs/testing';
import { ConversationFlowService } from './conversation-flow.service';
import { OrderFlowService } from './order-flow.service';
import { StateMachineService } from './state-machine.service';
import { InputParserService } from './input-parser.service';
import { ConversationSessionService } from './conversation-session.service';
import { ProductsRepository } from '../../products/products.repository';
import { CustomersRepository } from '../../customers/customers.repository';
import { ConversationState } from '../types/conversation.types';
import { UserIntent, EntityType } from '../types/input-parser.types';
import { StateTrigger, ContextKey } from '../types/state-machine.types';

describe('ConversationFlowService Integration', () => {
  let conversationFlowService: ConversationFlowService;
  let orderFlowService: OrderFlowService;
  let inputParserService: InputParserService;
  let sessionService: ConversationSessionService;
  let productsRepository: ProductsRepository;

  const mockPhoneNumber = '+1234567890';

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ConversationFlowService,
        {
          provide: StateMachineService,
          useValue: {
            canTransition: jest.fn().mockReturnValue(true),
            transition: jest.fn(),
          },
        },
        {
          provide: InputParserService,
          useValue: {
            validateInput: jest.fn().mockReturnValue({ isValid: true }),
            parseInput: jest.fn(),
            getEntityByType: jest.fn(),
          },
        },
        {
          provide: ConversationSessionService,
          useValue: {
            getSession: jest.fn(),
            createSession: jest.fn(),
            updateState: jest.fn(),
            updateContext: jest.fn(),
          },
        },
        {
          provide: OrderFlowService,
          useValue: {
            addItemToCart: jest.fn(),
            removeItemFromCart: jest.fn(),
            clearCart: jest.fn(),
            formatCartSummary: jest.fn(),
          },
        },
        {
          provide: ProductsRepository,
          useValue: {
            findAll: jest.fn(),
            findAvailableProducts: jest.fn(),
          },
        },
        {
          provide: CustomersRepository,
          useValue: {
            findByPhoneNumber: jest.fn(),
            findOrCreateByPhoneNumber: jest.fn(),
            create: jest.fn(),
          },
        },
      ],
    }).compile();

    conversationFlowService = module.get<ConversationFlowService>(ConversationFlowService);
    orderFlowService = module.get<OrderFlowService>(OrderFlowService);
    inputParserService = module.get<InputParserService>(InputParserService);
    sessionService = module.get<ConversationSessionService>(ConversationSessionService);
    productsRepository = module.get<ProductsRepository>(ProductsRepository);
  });

  describe('Cart Integration in Reviewing Order State', () => {
    it('should use OrderFlowService to remove items from cart', async () => {
      // Arrange
      const mockSession = {
        phoneNumber: mockPhoneNumber,
        currentState: ConversationState.REVIEWING_ORDER,
        lastActivity: new Date(),
        context: {
          [ContextKey.CURRENT_ORDER]: {
            items: [
              {
                productId: 'product-1',
                name: 'Pizza Margherita',
                quantity: 1,
                price: 25.99,
              },
            ],
            totalAmount: 25.99,
          },
        },
      };

      const mockParsedInput = {
        intent: UserIntent.REMOVE_FROM_CART,
        trigger: StateTrigger.REMOVE_FROM_CART,
        entities: [
          { type: EntityType.PRODUCT_NAME, value: 'Pizza Margherita', confidence: 0.9 },
        ],
        confidence: 0.9,
        originalText: 'remove pizza',
      };

      const mockRemoveResult = {
        success: true,
        cartSummary: {
          items: [],
          itemCount: 0,
          subtotal: 0,
          tax: 0,
          total: 0,
        },
      };

      jest.spyOn(inputParserService, 'getEntityByType').mockReturnValue({
        type: EntityType.PRODUCT_NAME,
        value: 'Pizza Margherita',
        confidence: 0.9,
      });
      jest.spyOn(orderFlowService, 'removeItemFromCart').mockResolvedValue(mockRemoveResult);
      jest.spyOn(orderFlowService, 'formatCartSummary').mockReturnValue('🛒 Your cart is empty');

      // Act
      const result = await conversationFlowService['handleReviewingOrderState'](
        mockSession,
        mockParsedInput,
      );

      // Assert
      expect(orderFlowService.removeItemFromCart).toHaveBeenCalledWith(
        mockSession,
        'product-1',
      );
      expect(result.message).toContain('Removed Pizza Margherita from your cart');
      expect(result.message).toContain('Your cart is empty');
    });

    it('should use OrderFlowService to clear cart when cancelling order', async () => {
      // Arrange
      const mockSession = {
        phoneNumber: mockPhoneNumber,
        currentState: ConversationState.REVIEWING_ORDER,
        lastActivity: new Date(),
        context: {
          [ContextKey.CURRENT_ORDER]: {
            items: [
              {
                productId: 'product-1',
                name: 'Pizza Margherita',
                quantity: 1,
                price: 25.99,
              },
            ],
            totalAmount: 25.99,
          },
        },
      };

      const mockParsedInput = {
        intent: UserIntent.CANCEL_ORDER,
        trigger: StateTrigger.CANCEL_ORDER,
        entities: [],
        confidence: 0.9,
        originalText: 'cancel order',
      };

      const mockClearResult = {
        success: true,
        cartSummary: {
          items: [],
          itemCount: 0,
          subtotal: 0,
          tax: 0,
          total: 0,
        },
      };

      jest.spyOn(orderFlowService, 'clearCart').mockResolvedValue(mockClearResult);

      // Act
      const result = await conversationFlowService['handleReviewingOrderState'](
        mockSession,
        mockParsedInput,
      );

      // Assert
      expect(orderFlowService.clearCart).toHaveBeenCalledWith(mockSession);
      expect(result.message).toContain('order has been cancelled');
      expect(result.nextState).toBe(ConversationState.GREETING);
    });
  });

  describe('Product Selection Integration', () => {
    it('should properly handle product selection in adding to cart state', async () => {
      // Arrange
      const mockSession = {
        phoneNumber: mockPhoneNumber,
        currentState: ConversationState.ADDING_TO_CART,
        lastActivity: new Date(),
        context: {},
      };

      const mockParsedInput = {
        intent: UserIntent.ADD_TO_CART,
        trigger: StateTrigger.ADD_TO_CART,
        entities: [
          { type: EntityType.PRODUCT_NAME, value: 'Pizza Margherita', confidence: 0.9 },
          { type: EntityType.QUANTITY, value: '2', confidence: 0.9 },
        ],
        confidence: 0.9,
        originalText: '2 Pizza Margherita',
      };

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
      ];

      jest.spyOn(inputParserService, 'getEntityByType')
        .mockImplementation((entities, type) => {
          return entities.find(e => e.type === type);
        });
      jest.spyOn(productsRepository, 'findAll').mockResolvedValue(mockProducts);
      jest.spyOn(sessionService, 'updateContext').mockResolvedValue(true);

      // Act
      const result = await conversationFlowService['handleAddingToCartState'](
        mockSession,
        mockParsedInput,
      );

      // Assert
      expect(result.message).toContain('Adding 2x Pizza Margherita');
      expect(result.context[ContextKey.SELECTED_PRODUCTS]).toEqual([
        {
          name: 'Pizza Margherita',
          quantity: 2,
          productId: 'product-1',
        },
      ]);
    });

    it('should handle product not found gracefully', async () => {
      // Arrange
      const mockSession = {
        phoneNumber: mockPhoneNumber,
        currentState: ConversationState.ADDING_TO_CART,
        lastActivity: new Date(),
        context: {},
      };

      const mockParsedInput = {
        intent: UserIntent.ADD_TO_CART,
        trigger: StateTrigger.ADD_TO_CART,
        entities: [
          { type: EntityType.PRODUCT_NAME, value: 'Nonexistent Product', confidence: 0.9 },
        ],
        confidence: 0.9,
        originalText: 'Nonexistent Product',
      };

      jest.spyOn(inputParserService, 'getEntityByType')
        .mockImplementation((entities, type) => {
          return entities.find(e => e.type === type);
        });
      jest.spyOn(productsRepository, 'findAll').mockResolvedValue([]);

      // Act
      const result = await conversationFlowService['handleAddingToCartState'](
        mockSession,
        mockParsedInput,
      );

      // Assert
      expect(result.message).toContain("couldn't find \"Nonexistent Product\"");
    });
  });
});