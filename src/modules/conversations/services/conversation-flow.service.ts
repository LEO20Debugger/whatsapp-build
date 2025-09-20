import { Injectable, Logger } from "@nestjs/common";
import {
  ConversationState,
  BotResponse,
  ConversationSession,
} from "../types/conversation.types";
import {
  ParsedInput,
  UserIntent,
  EntityType,
} from "../types/input-parser.types";
import { StateTrigger, ContextKey } from "../types/state-machine.types";
import { StateMachineService } from "./state-machine.service";
import { InputParserService } from "./input-parser.service";
import { ConversationSessionService } from "./conversation-session.service";
import { OrderFlowService } from "./order-flow.service";
import { ProductsRepository } from "../../products/products.repository";
import { CustomersRepository } from "../../customers/customers.repository";

@Injectable()
export class ConversationFlowService {
  private readonly logger = new Logger(ConversationFlowService.name);

  constructor(
    private readonly stateMachineService: StateMachineService,
    private readonly inputParserService: InputParserService,
    private readonly sessionService: ConversationSessionService,
    private readonly orderFlowService: OrderFlowService,
    private readonly productsRepository: ProductsRepository,
    private readonly customersRepository: CustomersRepository,
  ) {}

  async processMessage(
    phoneNumber: string,
    message: string,
  ): Promise<BotResponse> {
    try {
      const validation = this.inputParserService.validateInput(message);
      if (!validation.isValid) {
        return {
          message:
            "Sorry, I couldn't understand your message. Please try again.",
        };
      }

      let session = await this.sessionService.getSession(phoneNumber);
      if (!session) {
        session = await this.sessionService.createSession(phoneNumber);
        if (!session) {
          return {
            message:
              "Sorry, I'm having trouble starting our conversation. Please try again later.",
          };
        }
      }

      const parsedInput = await this.inputParserService.parseInput(message, {
        currentState: session.currentState,
        previousMessages: [session.context[ContextKey.LAST_MESSAGE] || ""],
        sessionContext: session.context,
      });

      session.context[ContextKey.LAST_MESSAGE] = message;

      const response = await this.handleStateFlow(session, parsedInput);

      if (response.nextState && response.nextState !== session.currentState) {
        await this.sessionService.updateState(
          phoneNumber,
          response.nextState,
          response.context || session.context,
        );
      } else if (response.context) {
        await this.sessionService.updateContext(phoneNumber, response.context);
      }

      return response;
    } catch (error) {
      this.logger.error("Error processing message", {
        phoneNumber,
        message,
        error: error.message,
      });
      return {
        message:
          'Sorry, I encountered an error. Please try again or type "help" for assistance.',
      };
    }
  }

  private async handleStateFlow(
    session: ConversationSession,
    parsedInput: ParsedInput,
  ): Promise<BotResponse> {
    // Check for restart commands (hello, hi) in any state
    const userInput = parsedInput.originalText.trim().toLowerCase();
    if (userInput === 'hello' || userInput === 'hi' || userInput === 'hey') {
      // Clear session context and restart
      session.context = {};
      
      // Call greeting state to show menu immediately
      return await this.handleGreetingState(session, parsedInput);
    }

    const stateHandlers = {
      [ConversationState.GREETING]: this.handleGreetingState.bind(this),
      [ConversationState.COLLECTING_NAME]: this.handleCollectingNameState.bind(this),
      [ConversationState.MAIN_MENU]: this.handleMainMenuState.bind(this),
      [ConversationState.BROWSING_PRODUCTS]:
        this.handleBrowsingProductsState.bind(this),
      [ConversationState.ADDING_TO_CART]:
        this.handleAddingToCartState.bind(this),
      [ConversationState.COLLECTING_QUANTITY]:
        this.handleCollectingQuantityState.bind(this),
      [ConversationState.REVIEWING_ORDER]:
        this.handleReviewingOrderState.bind(this),
      [ConversationState.AWAITING_PAYMENT]:
        this.handleAwaitingPaymentState.bind(this),
      [ConversationState.PAYMENT_CONFIRMATION]:
        this.handlePaymentConfirmationState.bind(this),
      [ConversationState.ORDER_COMPLETE]:
        this.handleOrderCompleteState.bind(this),
    };

    const handler = stateHandlers[session.currentState];
    if (handler) return handler(session, parsedInput);

    return {
      message: "I'm not sure what to do right now. Let me start over.",
      nextState: ConversationState.GREETING,
    };
  }

  private async handleGreetingState(
    session: ConversationSession,
    parsedInput: ParsedInput,
  ): Promise<BotResponse> {
    // Always give the same friendly greeting with Leo introduction and show menu immediately
    try {
      // Get available products from database
      const products = await this.productsRepository.findAvailableProducts();
      
      if (!products || products.length === 0) {
        return {
          message: `Hi there! 👋 My name is Leo.. Welcome to Chicken Republic Restaurant! 🍗\n\nI'm here to help you order some delicious food today!\n\nSorry, we don't have any products available right now. Please try again later.`,
          nextState: ConversationState.BROWSING_PRODUCTS,
        };
      }

      // Group products by category
      const productsByCategory = products.reduce((acc, product) => {
        const category = product.category || 'Other';
        if (!acc[category]) acc[category] = [];
        acc[category].push(product);
        return acc;
      }, {} as Record<string, any[]>);

      // Build greeting + menu message
      let fullMessage = `Hi there! 👋 My name is Leo.. Welcome to Chicken Republic Restaurant! 🍗\n\nI'm here to help you order some delicious food today!\n\n`;
      fullMessage += `Here's our delicious menu! 🍽️\n\n`;
      
      let globalIndex = 1;
      
      Object.entries(productsByCategory).forEach(([category, categoryProducts]) => {
        fullMessage += `**${category.toUpperCase()}** 🍴\n`;
        categoryProducts.forEach((product) => {
          const price = parseFloat(product.price).toLocaleString('en-NG', {
            style: 'currency',
            currency: 'NGN',
            minimumFractionDigits: 0,
          });
          fullMessage += `${globalIndex}. ${product.name} - ${price}\n`;
          if (product.description) {
            fullMessage += `   ${product.description}\n`;
          }
          globalIndex++;
        });
        fullMessage += '\n';
      });

      fullMessage += `💡 **What would you like to order?**\n\n`;
      fullMessage += `• Type a number (1-${globalIndex-1}) to select a product\n`;
      fullMessage += `• Type the product name to add to cart\n`;
      fullMessage += `• Type "cart" to view your cart\n`;
      fullMessage += `• Type "no" if you're just browsing\n\n`;
      fullMessage += `Select 1 or 2 to add the product to cart:`;

      return {
        message: fullMessage,
        nextState: ConversationState.ADDING_TO_CART,
        context: {
          ...session.context,
          [ContextKey.SELECTED_PRODUCTS]: products,
        },
      };
    } catch (error) {
      this.logger.error(`Error in greeting state: ${error.message}`);
      return {
        message: `Hi there! 👋 My name is Leo.. Welcome to Chicken Republic Restaurant! 🍗\n\nI'm here to help you order some delicious food today!\n\nSorry, I'm having trouble loading our menu right now. Please try again later.`,
        nextState: ConversationState.BROWSING_PRODUCTS,
      };
    }
  }

  private async handleCollectingNameState(
    session: ConversationSession,
    parsedInput: ParsedInput,
  ): Promise<BotResponse> {
    const userMessage = parsedInput.originalText.trim();

    // Validate name input
    if (userMessage.length < 2 || userMessage.length > 50) {
      return {
        message: `Please enter a valid name between 2-50 characters.\n\n💭 For example: "John" or "Sarah"\n\nWhat's your name?`,
      };
    }

    // Check if it looks like a name (basic validation)
    if (!/^[a-zA-Z\s'-]+$/.test(userMessage)) {
      return {
        message: `Please enter your name using only letters.\n\n💭 For example: "John Smith" or "Mary-Jane"\n\nWhat's your name?`,
      };
    }

    // Capitalize the name properly
    const formattedName = this.formatCustomerName(userMessage);

    try {
      // Save the customer name to database
      const customer = await this.customersRepository.findOrCreateByPhoneNumber(
        session.phoneNumber,
        formattedName,
      );

      // Update session context
      session.context[ContextKey.CUSTOMER_NAME] = formattedName;
      session.context[ContextKey.CUSTOMER_INFO] = customer;
      session.context[ContextKey.IS_NEW_CUSTOMER] = false;

      return {
        message: `🎉 **Welcome ${formattedName}!** 😊\n\n✅ Your information has been saved securely\n🍽️ You're now ready to explore our delicious menu!\n\nI'm excited to help you order some amazing food today!`,
        nextState: ConversationState.BROWSING_PRODUCTS,
        context: session.context,
      };
    } catch (error) {
      this.logger.error(`Failed to save customer name: ${error.message}`);
      return {
        message: `😔 Sorry, I had trouble saving your information.\n\nLet's try again - what's your name?`,
      };
    }
  }

  private handleMainMenuState(
    session: ConversationSession,
    parsedInput: ParsedInput,
  ): BotResponse {
    const userInput = parsedInput.originalText.trim();
    const customerName = session.context[ContextKey.CUSTOMER_NAME];
    const customerInfo = session.context[ContextKey.CUSTOMER_INFO];

    // Handle menu selections
    switch (userInput) {
      case '1':
      case '2':
        return {
          message: `${this.getPersonalizedMessage(customerName, "Excellent")}! 🛒\n\nLet's get your order started. I'll show you our amazing products!`,
          nextState: ConversationState.BROWSING_PRODUCTS,
        };

      case '3':
        // Check order status (future feature)
        const orderMessage = customerName 
          ? `Hi ${customerName}! 📋 Order tracking is coming soon!\n\nFor now, would you like to place a new order?`
          : `📋 Order tracking feature is coming soon!\n\nWould you like to browse our menu?`;
        return {
          message: orderMessage,
          nextState: ConversationState.BROWSING_PRODUCTS,
        };

      case '4':
        return this.getHelpMenu(customerName);

      case '0':
        const exitMessage = customerName 
          ? `Thank you ${customerName}! 👋 It was great serving you today!\n\nType any message anytime to return - I'll remember you! 😊`
          : `Thank you for visiting! 👋\n\nType any message to return to the main menu.`;
        return {
          message: exitMessage,
        };

      default:
        // Show main menu for invalid input
        const menuMessage = this.getMainMenuMessage(customerName, customerInfo);
        return {
          message: menuMessage,
        };
    }
  }

  private async handleBrowsingProductsState(
    session: ConversationSession, 
    parsedInput: ParsedInput
  ): Promise<BotResponse> {
    try {
      // Get available products from database
      const products = await this.productsRepository.findAvailableProducts();
      
      if (!products || products.length === 0) {
        return {
          message: `Sorry, we don't have any products available right now. Please try again later.`,
          nextState: ConversationState.BROWSING_PRODUCTS,
        };
      }

      // Group products by category
      const productsByCategory = products.reduce((acc, product) => {
        const category = product.category || 'Other';
        if (!acc[category]) acc[category] = [];
        acc[category].push(product);
        return acc;
      }, {} as Record<string, any[]>);

      // Build menu message with global numbering
      let menuMessage = `Here's our delicious menu! 🍽️\n\n`;
      let globalIndex = 1;
      
      Object.entries(productsByCategory).forEach(([category, categoryProducts]) => {
        menuMessage += `**${category.toUpperCase()}** 🍴\n`;
        categoryProducts.forEach((product) => {
          const price = parseFloat(product.price).toLocaleString('en-NG', {
            style: 'currency',
            currency: 'NGN',
            minimumFractionDigits: 0,
          });
          menuMessage += `${globalIndex}. ${product.name} - ${price}\n`;
          if (product.description) {
            menuMessage += `   ${product.description}\n`;
          }
          globalIndex++;
        });
        menuMessage += '\n';
      });

      menuMessage += `💡 **What would you like to order?**\n\n`;
      menuMessage += `• Type a number (1-${globalIndex-1}) to select a product\n`;
      menuMessage += `• Type the product name to add to cart\n`;
      menuMessage += `• Type "cart" to view your cart\n`;
      menuMessage += `• Type "no" if you're just browsing\n\n`;
      menuMessage += `Select 1 or 2 to add the product to cart:`;

      return {
        message: menuMessage,
        nextState: ConversationState.ADDING_TO_CART,
        context: {
          ...session.context,
          [ContextKey.SELECTED_PRODUCTS]: products,
        },
      };
    } catch (error) {
      this.logger.error(`Error fetching products: ${error.message}`);
      return {
        message: `Sorry, I'm having trouble loading our menu right now. Please try again later.`,
        nextState: ConversationState.BROWSING_PRODUCTS,
      };
    }
  }

  private async handleAddingToCartState(
    session: ConversationSession, 
    parsedInput: ParsedInput
  ): Promise<BotResponse> {
    const userInput = parsedInput.originalText.trim().toLowerCase();
    
    // Handle special commands
    if (userInput === 'cart') {
      return this.showCart(session);
    }
    
    if (userInput === 'no' || userInput === 'just browsing' || userInput === 'browsing') {
      return {
        message: `No problem! 😊 Feel free to browse our delicious menu anytime.\n\nWhenever you're ready to order, just type a number or product name. I'm always here to help! 🍗`,
        nextState: ConversationState.BROWSING_PRODUCTS,
      };
    }
    
    if (userInput === 'checkout' || userInput === 'review order') {
      return this.proceedToCheckout(session);
    }

    try {
      // Always fetch fresh products to ensure we have the latest data
      const availableProducts = await this.productsRepository.findAvailableProducts();
      
      if (!availableProducts || availableProducts.length === 0) {
        return {
          message: `Sorry, we don't have any products available right now. Please try again later.`,
          nextState: ConversationState.BROWSING_PRODUCTS,
        };
      }

      // Update session context with fresh products
      session.context[ContextKey.SELECTED_PRODUCTS] = availableProducts;

      // Check if user entered a number
      const productNumber = parseInt(userInput);
      let matchedProduct = null;

      if (!isNaN(productNumber) && productNumber > 0 && productNumber <= availableProducts.length) {
        // User selected by number
        matchedProduct = availableProducts[productNumber - 1];
      } else {
        // Find product by name (fuzzy matching)
        matchedProduct = this.findProductByName(userInput, availableProducts);
      }
      
      if (!matchedProduct) {
        return {
          message: `I couldn't find "${parsedInput.originalText}" in our menu.\n\n💡 Try typing a number (1-${availableProducts.length}) or the exact product name.\n\nType "menu" to see all products or "cart" to view your current cart.`,
        };
      }

      // Store selected product and ask for quantity
      session.context[ContextKey.SELECTED_PRODUCT_FOR_QUANTITY] = matchedProduct;

      const price = parseFloat(matchedProduct.price).toLocaleString('en-NG', {
        style: 'currency',
        currency: 'NGN',
        minimumFractionDigits: 0,
      });

      return {
        message: `🍽️ **${matchedProduct.name}** - ${price}\n${matchedProduct.description ? `${matchedProduct.description}\n\n` : '\n'}📦 **How many would you like?**\n\nType a number (e.g., 1, 2, 3...)\nOr type "no" if you're just browsing.`,
        nextState: ConversationState.COLLECTING_QUANTITY,
        context: session.context,
      };

    } catch (error) {
      this.logger.error(`Error adding to cart: ${error.message}`);
      return {
        message: `Sorry, I had trouble adding that to your cart. Please try again.`,
      };
    }
  }

  private async handleCollectingQuantityState(
    session: ConversationSession, 
    parsedInput: ParsedInput
  ): Promise<BotResponse> {
    const selectedProduct = session.context[ContextKey.SELECTED_PRODUCT_FOR_QUANTITY];
    const userInput = parsedInput.originalText.trim().toLowerCase();

    if (!selectedProduct) {
      return {
        message: `Sorry, something went wrong. Let's start over.`,
        nextState: ConversationState.BROWSING_PRODUCTS,
      };
    }

    // Handle browsing option
    if (userInput === 'no' || userInput === 'just browsing' || userInput === 'browsing') {
      // Clear selected product
      delete session.context[ContextKey.SELECTED_PRODUCT_FOR_QUANTITY];
      return {
        message: `No problem! 😊 Feel free to browse our delicious menu anytime.\n\nWhenever you're ready to order, just type a number or product name. I'm always here to help! 🍗`,
        nextState: ConversationState.BROWSING_PRODUCTS,
        context: session.context,
      };
    }

    // Parse quantity
    const quantity = parseInt(userInput);
    
    if (isNaN(quantity) || quantity < 1 || quantity > 99) {
      return {
        message: `Please enter a valid quantity between 1 and 99.\n\n📦 How many **${selectedProduct.name}** would you like?\n\nOr type "no" if you're just browsing.`,
      };
    }

    try {
      // Add product to cart with specified quantity
      const addToCartResult = await this.orderFlowService.addItemToCart(
        session,
        selectedProduct.id,
        quantity
      );

      if (!addToCartResult.success) {
        return {
          message: `Sorry, I couldn't add "${selectedProduct.name}" to your cart. ${addToCartResult.error || 'Please try again.'}`,
          nextState: ConversationState.ADDING_TO_CART,
        };
      }

      // Clear selected product from context
      delete session.context[ContextKey.SELECTED_PRODUCT_FOR_QUANTITY];

      const price = parseFloat(selectedProduct.price).toLocaleString('en-NG', {
        style: 'currency',
        currency: 'NGN',
        minimumFractionDigits: 0,
      });

      const totalPrice = (parseFloat(selectedProduct.price) * quantity).toLocaleString('en-NG', {
        style: 'currency',
        currency: 'NGN',
        minimumFractionDigits: 0,
      });

      const availableProducts = session.context[ContextKey.SELECTED_PRODUCTS] || [];

      return {
        message: `✅ **Added to cart!**\n\n🍽️ ${selectedProduct.name} x${quantity} = ${totalPrice}\n\n🤔 **Do you want to add anything else?**\n\n• Type a number (1-${availableProducts.length}) or product name to add more\n• Type "cart" to view your cart\n• Type "checkout" to review your order\n• Type "no" if you're done browsing`,
        nextState: ConversationState.ADDING_TO_CART,
        context: session.context,
      };

    } catch (error) {
      this.logger.error(`Error adding to cart: ${error.message}`);
      return {
        message: `Sorry, I had trouble adding that to your cart. Please try again.`,
        nextState: ConversationState.ADDING_TO_CART,
      };
    }
  }

  /**
   * Get personalized message with customer name
   */
  private getPersonalizedMessage(customerName: string | null, defaultMessage: string): string {
    if (!customerName) return defaultMessage;
    
    const personalizedPrefixes = [
      `${defaultMessage}, ${customerName}`,
      `Great choice, ${customerName}`,
      `Perfect, ${customerName}`,
      `Excellent, ${customerName}`,
      `Wonderful, ${customerName}`,
    ];
    
    return personalizedPrefixes[Math.floor(Math.random() * personalizedPrefixes.length)];
  }

  /**
   * Get main menu message with personalization
   */
  private getMainMenuMessage(customerName: string | null, customerInfo?: any): string {
    const greeting = customerName 
      ? `Hi ${customerName}! 😊 What would you like to do?`
      : `Hi there! 😊 What would you like to do?`;
    
    return `${greeting}\n\n📱 **MAIN MENU**\n\n1️⃣ 🍽️ Browse Products\n2️⃣ 🛒 Place Order\n3️⃣ 📋 Order Status\n4️⃣ ❓ Help\n0️⃣ 👋 Exit\n\n*Type the number of your choice:*`;
  }

  /**
   * Get help menu with personalization
   */
  private getHelpMenu(customerName?: string): BotResponse {
    const greeting = customerName ? `${customerName}, here's` : "Here's";
    
    return {
      message: `🤖 **HELP MENU**\n\n${greeting} how I can assist you:\n\n1️⃣ 📖 How to browse products\n2️⃣ 🛒 How to place an order\n3️⃣ 💳 Payment methods\n4️⃣ 📞 Contact support\n5️⃣ 🏠 Return to main menu\n0️⃣ ⬅️ Go back\n\n*Type a number (0-5):*`,
    };
  }

  /**
   * Format customer name properly
   */
  private formatCustomerName(name: string): string {
    return name
      .trim()
      .toLowerCase()
      .split(' ')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  }

  /**
   * Find product by name with fuzzy matching
   */
  private findProductByName(searchTerm: string, products: any[]): any | null {
    const normalizedSearch = searchTerm.toLowerCase().trim();
    
    // Exact match first
    let match = products.find(p => 
      p.name.toLowerCase() === normalizedSearch
    );
    
    if (match) return match;
    
    // Partial match
    match = products.find(p => 
      p.name.toLowerCase().includes(normalizedSearch) ||
      normalizedSearch.includes(p.name.toLowerCase())
    );
    
    if (match) return match;
    
    // Word-based matching
    const searchWords = normalizedSearch.split(' ');
    match = products.find(p => {
      const productWords = p.name.toLowerCase().split(' ');
      return searchWords.some(searchWord => 
        productWords.some(productWord => 
          productWord.includes(searchWord) || searchWord.includes(productWord)
        )
      );
    });
    
    return match || null;
  }

  /**
   * Show current cart contents
   */
  private async showCart(session: ConversationSession): Promise<BotResponse> {
    try {
      const cartSummary = this.orderFlowService.getCartSummary(session);
      
      if (!cartSummary || cartSummary.items.length === 0) {
        return {
          message: `Your cart is empty! 🛒\n\n🍽️ Browse our menu to add some delicious items!\n\nType "menu" to see our products.`,
          nextState: ConversationState.BROWSING_PRODUCTS,
        };
      }

      let cartMessage = `Here's your cart! 🛒\n\n`;
      
      cartSummary.items.forEach((item, index) => {
        const itemTotal = item.totalPrice.toLocaleString('en-NG', {
          style: 'currency',
          currency: 'NGN',
          minimumFractionDigits: 0,
        });
        cartMessage += `${index + 1}. ${item.productName} x${item.quantity} - ${itemTotal}\n`;
      });
      
      const total = cartSummary.total.toLocaleString('en-NG', {
        style: 'currency',
        currency: 'NGN',
        minimumFractionDigits: 0,
      });
      
      cartMessage += `\n💰 **Total: ${total}**\n\n`;
      cartMessage += `🛒 **Options:**\n`;
      cartMessage += `• Type "checkout" to review and place order\n`;
      cartMessage += `• Type "clear cart" to empty your cart\n`;
      cartMessage += `• Type a product name to add more items\n`;
      cartMessage += `• Type "menu" to return to main menu`;

      return {
        message: cartMessage,
      };
    } catch (error) {
      this.logger.error(`Error showing cart: ${error.message}`);
      return {
        message: `Sorry, I had trouble loading your cart. Please try again.`,
      };
    }
  }

  /**
   * Proceed to checkout
   */
  private async proceedToCheckout(session: ConversationSession): Promise<BotResponse> {
    try {
      const cartSummary = this.orderFlowService.getCartSummary(session);
      
      if (!cartSummary || cartSummary.items.length === 0) {
        return {
          message: `Your cart is empty! Please add some items first.\n\nType "menu" to browse our products.`,
          nextState: ConversationState.BROWSING_PRODUCTS,
        };
      }

      return {
        message: `Let's review your order! 📋`,
        nextState: ConversationState.REVIEWING_ORDER,
      };
    } catch (error) {
      this.logger.error(`Error proceeding to checkout: ${error.message}`);
      return {
        message: `Sorry, I had trouble processing your checkout. Please try again.`,
      };
    }
  }

  // Placeholder methods for other states
  private async handleReviewingOrderState(session: ConversationSession, parsedInput: ParsedInput): Promise<BotResponse> {
    return {
      message: `Reviewing order! (Implementation needed)`,
    };
  }

  private handleAwaitingPaymentState(session: ConversationSession, parsedInput: ParsedInput): BotResponse {
    return {
      message: `Awaiting payment! (Implementation needed)`,
    };
  }

  private handlePaymentConfirmationState(session: ConversationSession, parsedInput: ParsedInput): BotResponse {
    return {
      message: `Payment confirmation! (Implementation needed)`,
    };
  }

  private handleOrderCompleteState(session: ConversationSession, parsedInput: ParsedInput): BotResponse {
    return {
      message: `Order complete! (Implementation needed)`,
    };
  }
}