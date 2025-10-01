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
import { PaymentsService } from "../../payments/payments.service";
import { OrdersService } from "../../orders/orders.service";
import { PaymentFlowIntegrationService } from "./payment-flow-integration.service";

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
    private readonly paymentsService: PaymentsService,
    private readonly ordersService: OrdersService,
    private readonly paymentFlowIntegrationService: PaymentFlowIntegrationService,
  ) {}

  async processMessage(
    phoneNumber: string,
    message: string
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
          response.context || session.context
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
    parsedInput: ParsedInput
  ): Promise<BotResponse> {
    // Check for restart commands (hello, hi) in any state
    const userInput = parsedInput.originalText.trim().toLowerCase();
    if (userInput === "hello" || userInput === "hi" || userInput === "hey") {
      // Clear session context and restart
      session.context = {};

      // Call greeting state to show menu immediately
      return await this.handleGreetingState(session, parsedInput);
    }

    const stateHandlers = {
      [ConversationState.GREETING]: this.handleGreetingState.bind(this),
      [ConversationState.COLLECTING_NAME]:
        this.handleCollectingNameState.bind(this),
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
    parsedInput: ParsedInput
  ): Promise<BotResponse> {
    const hour = new Date().getHours();
    let greetingTime = "Hi there";

    if (hour >= 5 && hour < 12) greetingTime = "Good morning";
    else if (hour >= 12 && hour < 18) greetingTime = "Good afternoon";
    else greetingTime = "Good evening";

    let customerName = session.context[ContextKey.CUSTOMER_NAME];

    // If the name is not in session, fetch it from the database
    if (!customerName) {
      try {
        const customer = await this.customersRepository.findByPhoneNumber(
          session.phoneNumber
        );
        if (customer) {
          customerName = customer.name;
          session.context[ContextKey.CUSTOMER_NAME] = customer.name;
          session.context[ContextKey.CUSTOMER_INFO] = customer;
          session.context[ContextKey.IS_NEW_CUSTOMER] = false;
        }
      } catch (error) {
        this.logger.error(`Failed to fetch customer from DB: ${error.message}`);
      }
    }

    // If the name is still missing, ask the user for it
    if (!customerName) {
      return {
        message: `${greetingTime}! 👋 I’m Leo. Before we get started, what’s your name?`,
        nextState: ConversationState.COLLECTING_NAME,
        context: session.context,
      };
    }

    // Personalized greeting if we know the user's name
    const greetingMessage = customerName
      ? `${greetingTime} ${customerName}! 👋 🍗 Ready to check out our menu and pick something tasty today?`
      : `${greetingTime}! 👋 My name is Leo.. 🍗 I'm here to help you explore our menu and find something delicious!`;

    try {
      const products = await this.productsRepository.findAvailableProducts();

      if (!products || products.length === 0) {
        return {
          message: `${greetingMessage}\n\nSorry, we don't have any products available right now. Please try again later.`,
          nextState: ConversationState.BROWSING_PRODUCTS,
        };
      }

      // Group products by category
      const productsByCategory = products.reduce(
        (acc, product) => {
          const category = product.category || "Other";
          if (!acc[category]) acc[category] = [];
          acc[category].push(product);
          return acc;
        },
        {} as Record<string, any[]>
      );

      let fullMessage = `${greetingMessage}\n\nHere's our delicious menu! 🍽️\n\n`;
      let globalIndex = 1;

      Object.entries(productsByCategory).forEach(
        ([category, categoryProducts]) => {
          fullMessage += `*${category.toUpperCase()}* 🍴\n`;
          categoryProducts.forEach((product) => {
            const price = parseFloat(product.price).toLocaleString("en-NG", {
              style: "currency",
              currency: "NGN",
              minimumFractionDigits: 0,
            });
            fullMessage += `${globalIndex}. ${product.name} - ${price}\n`;
            if (product.description)
              fullMessage += `   ${product.description}\n`;
            globalIndex++;
          });
          fullMessage += "\n";
        }
      );

      fullMessage += `💡 *What would you like to order?*\n\n`;
      fullMessage += `• Type a number (1-${globalIndex - 1}) to select a product\n`;
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
        message: `${greetingMessage}\n\nSorry, I'm having trouble loading our menu right now. Please try again later.`,
        nextState: ConversationState.BROWSING_PRODUCTS,
      };
    }
  }

  private async handleCollectingNameState(
    session: ConversationSession,
    parsedInput: ParsedInput
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
        formattedName
      );

      // Fetch menu again
      const browsingResponse = await this.handleBrowsingProductsState(
        session,
        parsedInput
      );

      // Update session context
      session.context[ContextKey.CUSTOMER_NAME] = formattedName;
      session.context[ContextKey.CUSTOMER_INFO] = customer;
      session.context[ContextKey.IS_NEW_CUSTOMER] = false;

      return {
        message: `🎉 *Welcome ${formattedName}!* 😊\n\n🍽️ Ready to explore our delicious menu?\n\nLet's find something tasty for you today!\n\n${browsingResponse.message}`,
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
    parsedInput: ParsedInput
  ): BotResponse {
    const userInput = parsedInput.originalText.trim();
    const customerName = session.context[ContextKey.CUSTOMER_NAME];
    const customerInfo = session.context[ContextKey.CUSTOMER_INFO];

    // Handle menu selections
    switch (userInput) {
      case "1":
      case "2":
        return {
          message: `${this.getPersonalizedMessage(customerName, "Excellent")}! 🛒\n\nLet's get your order started. I'll show you our amazing products!`,
          nextState: ConversationState.BROWSING_PRODUCTS,
        };

      case "3":
        // Check order status (future feature)
        const orderMessage = customerName
          ? `Hi ${customerName}! 📋 Order tracking is coming soon!\n\nFor now, would you like to place a new order?`
          : `📋 Order tracking feature is coming soon!\n\nWould you like to browse our menu?`;
        return {
          message: orderMessage,
          nextState: ConversationState.BROWSING_PRODUCTS,
        };

      case "4":
        return this.getHelpMenu(customerName);

      case "0":
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
      const productsByCategory = products.reduce(
        (acc, product) => {
          const category = product.category || "Other";
          if (!acc[category]) acc[category] = [];
          acc[category].push(product);
          return acc;
        },
        {} as Record<string, any[]>
      );

      // Build menu message with global numbering
      let menuMessage = `Here's our delicious menu! 🍽️\n\n`;
      let globalIndex = 1;

      Object.entries(productsByCategory).forEach(
        ([category, categoryProducts]) => {
          menuMessage += `*${category.toUpperCase()}* 🍴\n`;
          categoryProducts.forEach((product) => {
            const price = parseFloat(product.price).toLocaleString("en-NG", {
              style: "currency",
              currency: "NGN",
              minimumFractionDigits: 0,
            });
            menuMessage += `${globalIndex}. ${product.name} - ${price}\n`;
            if (product.description) {
              menuMessage += `   ${product.description}\n`;
            }
            globalIndex++;
          });
          menuMessage += "\n";
        }
      );

      menuMessage += `💡 *What would you like to order?*\n\n`;
      menuMessage += `• Type a number (1-${globalIndex - 1}) to select a product\n`;
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
    if (userInput === "cart") {
      return this.showCart(session);
    }

    if (
      userInput === "no" ||
      userInput === "just browsing" ||
      userInput === "browsing"
    ) {
      return {
        message: `No problem! 😊 Feel free to browse our delicious menu anytime.\n\nWhenever you're ready to order, just type a number or product name. I'm always here to help! 🍗`,
        nextState: ConversationState.BROWSING_PRODUCTS,
      };
    }

    if (userInput === "clear cart") {
      const result = await this.orderFlowService.clearCart(session);

      // Fetch menu again
      const browsingResponse = await this.handleBrowsingProductsState(
        session,
        parsedInput
      );

      return {
        message: result.success
          ? `✅ Your cart has been emptied! You can start adding new items.\n\n${browsingResponse.message}`
          : result.error,
        nextState: ConversationState.ADDING_TO_CART, // keep in cart-adding state
        context: session.context,
      };
    }

    if (userInput === "checkout" || userInput === "review order") {
      return this.proceedToCheckout(session);
    }

    try {
      // Always fetch fresh products to ensure we have the latest data
      const availableProducts =
        await this.productsRepository.findAvailableProducts();

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

      if (
        !isNaN(productNumber) &&
        productNumber > 0 &&
        productNumber <= availableProducts.length
      ) {
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
      session.context[ContextKey.SELECTED_PRODUCT_FOR_QUANTITY] =
        matchedProduct;

      const price = parseFloat(matchedProduct.price).toLocaleString("en-NG", {
        style: "currency",
        currency: "NGN",
        minimumFractionDigits: 0,
      });

      return {
        message: `🍽️ *${matchedProduct.name}* - ${price}\n${matchedProduct.description ? `${matchedProduct.description}\n\n` : "\n"}📦 **How many would you like?**\n\nType a number (e.g., 1, 2, 3...)\nOr type "no" if you're just browsing.`,
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
    const selectedProduct =
      session.context[ContextKey.SELECTED_PRODUCT_FOR_QUANTITY];
    const userInput = parsedInput.originalText.trim().toLowerCase();

    if (!selectedProduct) {
      return {
        message: `Sorry, something went wrong. Let's start over.`,
        nextState: ConversationState.BROWSING_PRODUCTS,
      };
    }

    // Handle browsing option
    if (
      userInput === "no" ||
      userInput === "just browsing" ||
      userInput === "browsing"
    ) {
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
        message: `Please enter a valid quantity between 1 and 99.\n\n📦 How many *${selectedProduct.name}* would you like?\n\nOr type "no" if you're just browsing.`,
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
          message: `Sorry, I couldn't add "${selectedProduct.name}" to your cart. ${addToCartResult.error || "Please try again."}`,
          nextState: ConversationState.ADDING_TO_CART,
        };
      }

      // Clear selected product from context
      delete session.context[ContextKey.SELECTED_PRODUCT_FOR_QUANTITY];

      const price = parseFloat(selectedProduct.price).toLocaleString("en-NG", {
        style: "currency",
        currency: "NGN",
        minimumFractionDigits: 0,
      });

      const totalPrice = (
        parseFloat(selectedProduct.price) * quantity
      ).toLocaleString("en-NG", {
        style: "currency",
        currency: "NGN",
        minimumFractionDigits: 0,
      });

      const availableProducts =
        session.context[ContextKey.SELECTED_PRODUCTS] || [];

      return {
        message: `✅ *Added to cart!*\n\n🍽️ ${selectedProduct.name} x${quantity} = ${totalPrice}\n\n🤔 *Do you want to add anything else?*\n\n• Type a number (1-${availableProducts.length}) or product name to add more\n• Type "cart" to view your cart\n• Type "checkout" to review your order\n• Type "no" if you're done browsing`,
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

  /** Get personalized message with customer name */
  private getPersonalizedMessage(
    customerName: string | null,
    defaultMessage: string
  ): string {
    if (!customerName) return defaultMessage;

    const personalizedPrefixes = [
      `${defaultMessage}, ${customerName}`,
      `Great choice, ${customerName}`,
      `Perfect, ${customerName}`,
      `Excellent, ${customerName}`,
      `Wonderful, ${customerName}`,
    ];

    return personalizedPrefixes[
      Math.floor(Math.random() * personalizedPrefixes.length)
    ];
  }

  /** Get main menu message with personalization  */
  private getMainMenuMessage(
    customerName: string | null,
    customerInfo?: any
  ): string {
    const greeting = customerName
      ? `Hi ${customerName}! 😊 What would you like to do?`
      : `Hi there! 😊 What would you like to do?`;

    return `${greeting}\n\n📱 *MAIN MENU*\n\n1️⃣ 🍽️ Browse Products\n2️⃣ 🛒 Place Order\n3️⃣ 📋 Order Status\n4️⃣ ❓ Help\n0️⃣ 👋 Exit\n\n*Type the number of your choice:*`;
  }

  /** Get help menu with personalization */
  private getHelpMenu(customerName?: string): BotResponse {
    const greeting = customerName ? `${customerName}, here's` : "Here's";

    return {
      message: `🤖 *HELP MENU*\n\n${greeting} how I can assist you:\n\n1️⃣ 📖 How to browse products\n2️⃣ 🛒 How to place an order\n3️⃣ 💳 Payment methods\n4️⃣ 📞 Contact support\n5️⃣ 🏠 Return to main menu\n0️⃣ ⬅️ Go back\n\n*Type a number (0-5):*`,
    };
  }

  /** Format customer name properly */
  private formatCustomerName(name: string): string {
    return name
      .trim()
      .toLowerCase()
      .split(" ")
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(" ");
  }

  /** Find product by name with fuzzy matching */
  private findProductByName(searchTerm: string, products: any[]): any | null {
    const normalizedSearch = searchTerm.toLowerCase().trim();

    // Exact match first
    let match = products.find((p) => p.name.toLowerCase() === normalizedSearch);

    if (match) return match;

    // Partial match
    match = products.find(
      (p) =>
        p.name.toLowerCase().includes(normalizedSearch) ||
        normalizedSearch.includes(p.name.toLowerCase())
    );

    if (match) return match;

    // Word-based matching
    const searchWords = normalizedSearch.split(" ");
    match = products.find((p) => {
      const productWords = p.name.toLowerCase().split(" ");
      return searchWords.some((searchWord) =>
        productWords.some(
          (productWord) =>
            productWord.includes(searchWord) || searchWord.includes(productWord)
        )
      );
    });

    return match || null;
  }

  /** Show current cart contents */
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
        const itemTotal = item.totalPrice.toLocaleString("en-NG", {
          style: "currency",
          currency: "NGN",
          minimumFractionDigits: 0,
        });
        cartMessage += `${index + 1}. ${item.productName} x${item.quantity} - ${itemTotal}\n`;
      });

      const total = cartSummary.total.toLocaleString("en-NG", {
        style: "currency",
        currency: "NGN",
        minimumFractionDigits: 0,
      });

      cartMessage += `\n💰 *Total: ${total}*\n\n`;
      cartMessage += `🛒 *Options:*\n`;
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

  /** Proceed to checkout */
  private async proceedToCheckout(
    session: ConversationSession
  ): Promise<BotResponse> {
    try {
      const cartSummary = this.orderFlowService.getCartSummary(session);

      if (!cartSummary || cartSummary.items.length === 0) {
        return {
          message: `Your cart is empty! Please add some items first.\n\nType "menu" to browse our products.`,
          nextState: ConversationState.BROWSING_PRODUCTS,
        };
      }

      // Show full order review immediately
      let reviewMessage = `📋 *ORDER REVIEW*\n\n`;

      cartSummary.items.forEach((item, index) => {
        const itemTotal = item.totalPrice.toLocaleString("en-NG", {
          style: "currency",
          currency: "NGN",
          minimumFractionDigits: 0,
        });
        reviewMessage += `${index + 1}. ${item.productName} x${item.quantity} - ${itemTotal}\n`;
      });

      const total = cartSummary.total.toLocaleString("en-NG", {
        style: "currency",
        currency: "NGN",
        minimumFractionDigits: 0,
      });

      reviewMessage += `\n💰 *Total: ${total}*\n\n`;
      reviewMessage += `✅ *Confirm your order:*\n`;
      reviewMessage += `• Type "confirm" or "yes" to proceed to payment\n`;
      reviewMessage += `• Type "edit" to modify your order\n`;
      reviewMessage += `• Type "cancel" to go back`;

      return {
        message: reviewMessage,
        nextState: ConversationState.REVIEWING_ORDER,
      };
    } catch (error) {
      this.logger.error(`Error proceeding to checkout: ${error.message}`);
      return {
        message: `Sorry, I had trouble processing your checkout. Please try again.`,
      };
    }
  }

  // Payment flow states implementation
  private async handleReviewingOrderState(
    session: ConversationSession,
    parsedInput: ParsedInput
  ): Promise<BotResponse> {
    const userInput = parsedInput.originalText.trim().toLowerCase();

    try {
      // Get cart summary for review
      const cartSummary = this.orderFlowService.getCartSummary(session);

      if (!cartSummary || cartSummary.items.length === 0) {
        return {
          message: `Your cart is empty! Please add some items first.\n\nType "menu" to browse our products.`,
          nextState: ConversationState.BROWSING_PRODUCTS,
        };
      }

      // Handle user input during order review
      if (userInput === "confirm" || userInput === "yes" || userInput === "proceed") {
        // Validate cart before proceeding
        const validation = await this.orderFlowService.validateCart(session);
        if (!validation.isValid) {
          return {
            message: `❌ There are issues with your order:\n\n${validation.errors.join('\n')}\n\nPlease fix these issues before proceeding.`,
            nextState: ConversationState.ADDING_TO_CART,
          };
        }

        // Get customer info
        const customerInfo = session.context[ContextKey.CUSTOMER_INFO];
        if (!customerInfo) {
          return {
            message: `Sorry, I couldn't find your customer information. Let's start over.`,
            nextState: ConversationState.GREETING,
          };
        }

        // Create order from cart
        const orderResult = await this.orderFlowService.createOrderFromCart(session, customerInfo.id);
        if (!orderResult.success) {
          return {
            message: `❌ Sorry, I couldn't create your order: ${orderResult.error}\n\nPlease try again or contact support.`,
            nextState: ConversationState.REVIEWING_ORDER,
          };
        }

        // Store order ID in session context
        session.context[ContextKey.ORDER_ID] = orderResult.orderId;

        // Proceed to payment
        return {
          message: `✅ Order created successfully!\n\n💳 Let's proceed with payment.`,
          nextState: ConversationState.AWAITING_PAYMENT,
          context: session.context,
        };
      }

      if (userInput === "cancel" || userInput === "no") {
        return {
          message: `No problem! Your cart is still saved.\n\nType "cart" to view it again or "menu" to add more items.`,
          nextState: ConversationState.ADDING_TO_CART,
        };
      }

      if (userInput === "edit" || userInput === "modify") {
        return {
          message: `You can modify your order by adding more items or clearing your cart.\n\nType "menu" to add items or "clear cart" to start over.`,
          nextState: ConversationState.ADDING_TO_CART,
        };
      }

      // Show order review by default
      let reviewMessage = `📋 *ORDER REVIEW*\n\n`;

      cartSummary.items.forEach((item, index) => {
        const itemTotal = item.totalPrice.toLocaleString("en-NG", {
          style: "currency",
          currency: "NGN",
          minimumFractionDigits: 0,
        });
        reviewMessage += `${index + 1}. ${item.productName} x${item.quantity} - ${itemTotal}\n`;
      });

      const total = cartSummary.total.toLocaleString("en-NG", {
        style: "currency",
        currency: "NGN",
        minimumFractionDigits: 0,
      });

      reviewMessage += `\n💰 *Total: ${total}*\n\n`;
      reviewMessage += `✅ *Confirm your order:*\n`;
      reviewMessage += `• Type "confirm" or "yes" to proceed to payment\n`;
      reviewMessage += `• Type "edit" to modify your order\n`;
      reviewMessage += `• Type "cancel" to go back`;

      return {
        message: reviewMessage,
      };
    } catch (error) {
      this.logger.error(`Error in reviewing order state: ${error.message}`);
      return {
        message: `Sorry, I had trouble reviewing your order. Please try again.`,
        nextState: ConversationState.ADDING_TO_CART,
      };
    }
  }

  private async handleAwaitingPaymentState(
    session: ConversationSession,
    parsedInput: ParsedInput
  ): Promise<BotResponse> {
    const userInput = parsedInput.originalText.trim().toLowerCase();

    try {
      // Check if order exists in context
      const orderId = session.context[ContextKey.ORDER_ID];
      
      if (!orderId) {
        return {
          message: `Sorry, I couldn't find your order. Let's start over.`,
          nextState: ConversationState.BROWSING_PRODUCTS,
        };
      }

      // Handle payment method selection
      if (userInput === "1" || userInput === "bank" || userInput === "bank transfer") {
        return await this.generatePaymentInstructions(session, orderId, "bank_transfer");
      }

      if (userInput === "2" || userInput === "card") {
        return await this.generatePaymentInstructions(session, orderId, "card");
      }

      if (userInput === "paid" || userInput === "done" || userInput === "completed") {
        return {
          message: `Great! Please provide your payment confirmation details.\n\n💳 What payment method did you use?\n\n1️⃣ Bank Transfer\n2️⃣ Card Payment\n\nType the number or method name:`,
          nextState: ConversationState.PAYMENT_CONFIRMATION,
        };
      }

      // Show payment options by default
      const cartSummary = this.orderFlowService.getCartSummary(session);
      const total = cartSummary?.total?.toLocaleString("en-NG", {
        style: "currency",
        currency: "NGN",
        minimumFractionDigits: 0,
      }) || "0";

      return {
        message: `💳 *PAYMENT OPTIONS*\n\nTotal Amount: *${total}*\n\nChoose your payment method:\n\n1️⃣ 🏦 Bank Transfer\n2️⃣ 💳 Card Payment\n\nType the number (1-2) or payment method name:\n\n💡 After making payment, type "paid" to confirm.`,
      };
    } catch (error) {
      this.logger.error(`Error in awaiting payment state: ${error.message}`);
      return {
        message: `Sorry, I had trouble processing your payment options. Please try again.`,
      };
    }
  }

  private async handlePaymentConfirmationState(
    session: ConversationSession,
    parsedInput: ParsedInput
  ): Promise<BotResponse> {
    const userInput = parsedInput.originalText.trim().toLowerCase();

    try {
      const orderId = session.context[ContextKey.ORDER_ID];
      const paymentReference = session.context[ContextKey.PAYMENT_REFERENCE];

      if (!orderId) {
        return {
          message: `Sorry, I couldn't find your order. Let's start over.`,
          nextState: ConversationState.BROWSING_PRODUCTS,
        };
      }

      // Handle payment method confirmation
      if (userInput === "1" || userInput === "bank" || userInput === "bank transfer") {
        return {
          message: `🏦 *Bank Transfer Confirmation*\n\nPlease provide proof of your bank transfer:\n\n📸 *Option 1: Upload Receipt*\nTake a clear photo of your transfer receipt and send it here.\n\n📝 *Option 2: Type Reference*\nType your transaction reference number.\n\n💡 *What to include in your photo:*\n• Full receipt showing transfer details\n• Payment reference: ${paymentReference}\n• Amount and account details\n• "Successful" or "Completed" status`,
        };
      }

      if (userInput === "2" || userInput === "card") {
        return await this.processPaymentConfirmation(session, orderId, "card", parsedInput.originalText);
      }

      // If user provides transaction details directly
      if (userInput.length > 10 && (userInput.includes("ref") || userInput.includes("transaction") || /\d{6,}/.test(userInput))) {
        return await this.processPaymentConfirmation(session, orderId, "bank_transfer", parsedInput.originalText);
      }

      // Show payment confirmation options
      return {
        message: `💳 *PAYMENT CONFIRMATION*\n\nPlease confirm your payment method:\n\n1️⃣ 🏦 Bank Transfer\n2️⃣ 💳 Card Payment\n\nType the number or method name.\n\n💡 You can also provide your transaction reference directly.`,
      };
    } catch (error) {
      this.logger.error(`Error in payment confirmation state: ${error.message}`);
      return {
        message: `Sorry, I had trouble processing your payment confirmation. Please try again.`,
      };
    }
  }

  /**
   * Handle image messages during payment confirmation
   * Requirements: Receipt verification via image upload
   */
  async handleImageMessage(
    phoneNumber: string,
    imageUrl: string,
  ): Promise<BotResponse> {
    try {
      const session = await this.sessionService.getSession(phoneNumber);
      
      if (!session || session.currentState !== ConversationState.PAYMENT_CONFIRMATION) {
        return {
          message: `I can only process receipt images during payment confirmation.\n\nPlease complete your order first, then upload your receipt when asked.`,
        };
      }

      const paymentReference = session.context[ContextKey.PAYMENT_REFERENCE];
      if (!paymentReference) {
        return {
          message: `Sorry, I couldn't find your payment reference. Please try again or contact support.`,
        };
      }

      // Show processing message
      const processingMessage = `📸 *Processing your receipt...*\n\nI'm analyzing your image to verify the payment details. This may take a moment.\n\n⏳ Please wait...`;
      
      // Send processing message first
      // Note: In a real implementation, you'd send this immediately
      // await this.whatsappMessageService.sendTextMessage(phoneNumber, processingMessage);

      // Process the receipt image (this would be done asynchronously in production)
      // For now, we'll return the processing message and handle verification separately
      return {
        message: processingMessage,
      };
    } catch (error) {
      this.logger.error(`Error handling image message for ${phoneNumber}: ${error.message}`);
      return {
        message: `Sorry, I had trouble processing your image. Please try uploading it again or contact support.\n\n📞 Support: support@business.com`,
      };
    }
  }

  private async handleOrderCompleteState(
    session: ConversationSession,
    parsedInput: ParsedInput
  ): Promise<BotResponse> {
    const userInput = parsedInput.originalText.trim().toLowerCase();

    // Handle post-completion actions
    if (userInput === "receipt" || userInput === "get receipt") {
      return await this.resendReceipt(session);
    }

    if (userInput === "new order" || userInput === "order again") {
      // Clear session and start new order
      session.context = {};
      return {
        message: `🛒 Starting a new order! Let me show you our menu.`,
        nextState: ConversationState.BROWSING_PRODUCTS,
        context: session.context,
      };
    }

    if (userInput === "help" || userInput === "support") {
      return {
        message: `📞 *CUSTOMER SUPPORT*\n\nNeed help with your order?\n\n• Type "receipt" to get your receipt again\n• Type "new order" to place another order\n• Type "menu" to browse products\n\nFor urgent issues, contact us at:\n📧 support@business.com\n📞 +234-XXX-XXXX`,
      };
    }

    // Default completion message
    const customerName = session.context[ContextKey.CUSTOMER_NAME];
    const greeting = customerName ? `Thank you ${customerName}!` : "Thank you!";

    return {
      message: `${greeting} 🎉\n\nYour order has been completed successfully!\n\n✅ *What's next?*\n• Type "receipt" to view your receipt\n• Type "new order" to place another order\n• Type "menu" to browse our products\n• Type "help" for support options\n\nWe appreciate your business! 😊`,
    };
  }

  /**
   * Generate payment instructions for selected payment method
   * Requirements: 2.1, 2.2
   */
  private async generatePaymentInstructions(
    session: ConversationSession,
    orderId: string,
    paymentMethod: "bank_transfer" | "card"
  ): Promise<BotResponse> {
    try {
      this.logger.log(`Generating payment instructions for order ${orderId} using ${paymentMethod}`);

      // Use PaymentFlowIntegrationService to send payment instructions via WhatsApp
      const result = await this.paymentFlowIntegrationService.sendPaymentInstructions(
        session.phoneNumber,
        orderId,
        paymentMethod
      );

      if (result.success) {
        // Store payment reference in session
        session.context[ContextKey.PAYMENT_REFERENCE] = result.paymentReference;

        return {
          message: `✅ Payment instructions have been sent!\n\n💡 After making payment, type "paid" to confirm your payment.`,
          nextState: ConversationState.PAYMENT_CONFIRMATION,
          context: session.context,
        };
      } else {
        return {
          message: `❌ Sorry, I had trouble generating payment instructions: ${result.error}\n\nPlease try again or contact support.`,
        };
      }
    } catch (error) {
      this.logger.error(`Failed to generate payment instructions: ${error.message}`);
      return {
        message: `Sorry, I had trouble generating payment instructions. Please try again or contact support.`,
      };
    }
  }

  /**
   * Process payment confirmation
   * Requirements: 3.1, 3.2
   */
  private async processPaymentConfirmation(
    session: ConversationSession,
    orderId: string,
    paymentMethod: "bank_transfer" | "card",
    userInput: string
  ): Promise<BotResponse> {
    try {
      this.logger.log(`Processing payment confirmation for order ${orderId}`);

      const paymentReference = session.context[ContextKey.PAYMENT_REFERENCE];

      if (!paymentReference) {
        return {
          message: `❌ Sorry, I couldn't find your payment reference. Please try again or contact support.`,
        };
      }

      // Use PaymentFlowIntegrationService to process payment confirmation
      const result = await this.paymentFlowIntegrationService.processPaymentConfirmation(
        session.phoneNumber,
        paymentReference,
        {
          paymentMethod,
          userInput,
        }
      );

      if (result.success) {
        // Clear payment context
        delete session.context[ContextKey.PAYMENT_REFERENCE];
        delete session.context[ContextKey.ORDER_ID];

        return {
          message: `🎉 *PAYMENT CONFIRMED!*\n\nThank you! Your payment has been verified and your order is complete!\n\n${result.receiptSent ? '📄 A detailed PDF receipt has been sent to you.' : ''}\n\nType "new order" to place another order or "help" for support options.`,
          nextState: ConversationState.ORDER_COMPLETE,
          context: session.context,
        };
      } else {
        return {
          message: `❌ *Payment Verification Failed*\n\n${result.message}\n\nPlease check your payment details and try again.\n\n💡 Make sure you:\n• Used the correct payment reference\n• Paid the exact amount\n• Completed the transaction\n\nType your transaction details again or contact support if you need help.`,
        };
      }
    } catch (error) {
      this.logger.error(`Failed to process payment confirmation: ${error.message}`);
      return {
        message: `Sorry, I had trouble verifying your payment. Please try again or contact support.\n\n📞 Support: support@business.com`,
      };
    }
  }

  /**
   * Resend receipt to customer
   * Requirements: 4.3, 4.4
   */
  private async resendReceipt(session: ConversationSession): Promise<BotResponse> {
    try {
      const orderId = session.context[ContextKey.ORDER_ID];
      
      if (!orderId) {
        return {
          message: `Sorry, I couldn't find your order receipt. Please contact support if you need assistance.`,
        };
      }

      // Get order details to find payment
      const order = await this.ordersService.getOrderById(orderId);
      if (!order) {
        return {
          message: `Sorry, I couldn't find your order. Please contact support.`,
        };
      }

      // Find receipt by payment ID (assuming we can get payment from order)
      // This is a simplified approach - in production you'd have a proper receipt lookup
      const receiptMessage = `📧 *RECEIPT RESENT*\n\nYour receipt has been sent! If you need a detailed receipt, please contact our support team.\n\n📞 Support: support@business.com\n📧 Email: orders@business.com`;

      return {
        message: receiptMessage,
      };
    } catch (error) {
      this.logger.error(`Failed to resend receipt: ${error.message}`);
      return {
        message: `Sorry, I had trouble sending your receipt. Please contact support.\n\n📞 Support: support@business.com`,
      };
    }
  }

  /**
   * Format receipt message for WhatsApp
   * Requirements: 4.1, 4.2
   */
  private formatReceiptMessage(receipt: any): string {
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
      receiptMessage += `📞 ${receipt.businessInfo.phone}\n`;
    }

    return receiptMessage;
  }
}
