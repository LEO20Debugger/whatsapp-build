import { Injectable, Logger } from "@nestjs/common";
import { ConversationState } from "../types/conversation.types";
import {
  StateDefinition,
  StateTransition,
  StateMachineConfig,
  TransitionResult,
  ValidationResult,
  StateTrigger,
  ContextKey,
} from "../types/state-machine.types";

@Injectable()
export class StateMachineService {
  private readonly logger = new Logger(StateMachineService.name);
  private readonly config: StateMachineConfig;

  constructor() {
    this.config = this.initializeStateMachine();
  }

  /** Initialize the state machine configuration */
  private initializeStateMachine(): StateMachineConfig {
    const states: StateDefinition[] = [
      {
        state: ConversationState.GREETING,
        description: "Initial greeting and welcome state",
        allowedTransitions: [
          ConversationState.BROWSING_PRODUCTS,
          ConversationState.GREETING, // Allow staying in greeting for help
        ],
        timeout: 300, // 5 minutes
      },
      {
        state: ConversationState.BROWSING_PRODUCTS,
        description: "Customer browsing available products",
        allowedTransitions: [
          ConversationState.ADDING_TO_CART,
          ConversationState.GREETING,
          ConversationState.BROWSING_PRODUCTS, // Allow staying for more browsing
        ],
        timeout: 600, // 10 minutes
      },
      {
        state: ConversationState.ADDING_TO_CART,
        description: "Customer adding products to cart",
        allowedTransitions: [
          ConversationState.BROWSING_PRODUCTS,
          ConversationState.REVIEWING_ORDER,
          ConversationState.ADDING_TO_CART, // Allow adding more items
          ConversationState.GREETING,
        ],
        timeout: 300, // 5 minutes
      },
      {
        state: ConversationState.REVIEWING_ORDER,
        description: "Customer reviewing their order before confirmation",
        allowedTransitions: [
          ConversationState.ADDING_TO_CART,
          ConversationState.AWAITING_PAYMENT,
          ConversationState.GREETING,
          ConversationState.BROWSING_PRODUCTS,
        ],
        timeout: 300, // 5 minutes
      },
      {
        state: ConversationState.AWAITING_PAYMENT,
        description: "Order confirmed, waiting for payment",
        allowedTransitions: [
          ConversationState.PAYMENT_CONFIRMATION,
          ConversationState.REVIEWING_ORDER,
          ConversationState.GREETING, // Allow cancellation
        ],
        timeout: 1800, // 30 minutes for payment
      },
      {
        state: ConversationState.PAYMENT_CONFIRMATION,
        description: "Processing payment confirmation",
        allowedTransitions: [
          ConversationState.ORDER_COMPLETE,
          ConversationState.AWAITING_PAYMENT,
          ConversationState.GREETING,
        ],
        timeout: 300, // 5 minutes
      },
      {
        state: ConversationState.ORDER_COMPLETE,
        description: "Order successfully completed",
        allowedTransitions: [
          ConversationState.GREETING, // Start new conversation
          ConversationState.BROWSING_PRODUCTS, // Browse for new order
        ],
        isTerminal: true,
        timeout: 60, // 1 minute before auto-reset
      },
    ];

    const transitions: StateTransition[] = [
      // From GREETING
      {
        from: ConversationState.GREETING,
        to: ConversationState.BROWSING_PRODUCTS,
        trigger: StateTrigger.VIEW_PRODUCTS,
      },
      {
        from: ConversationState.GREETING,
        to: ConversationState.GREETING,
        trigger: StateTrigger.REQUEST_HELP,
      },

      // From BROWSING_PRODUCTS
      {
        from: ConversationState.BROWSING_PRODUCTS,
        to: ConversationState.ADDING_TO_CART,
        trigger: StateTrigger.ADD_TO_CART,
        condition: (context) => {
          // Must have selected a valid product
          return (
            context[ContextKey.SELECTED_PRODUCTS] &&
            Array.isArray(context[ContextKey.SELECTED_PRODUCTS]) &&
            context[ContextKey.SELECTED_PRODUCTS].length > 0
          );
        },
      },
      {
        from: ConversationState.BROWSING_PRODUCTS,
        to: ConversationState.GREETING,
        trigger: StateTrigger.GO_BACK,
      },

      // From ADDING_TO_CART
      {
        from: ConversationState.ADDING_TO_CART,
        to: ConversationState.BROWSING_PRODUCTS,
        trigger: StateTrigger.VIEW_PRODUCTS,
      },
      {
        from: ConversationState.ADDING_TO_CART,
        to: ConversationState.REVIEWING_ORDER,
        trigger: StateTrigger.REVIEW_ORDER,
        condition: (context) => {
          // Must have items in cart
          const currentOrder = context[ContextKey.CURRENT_ORDER];
          return (
            currentOrder && currentOrder.items && currentOrder.items.length > 0
          );
        },
      },
      {
        from: ConversationState.ADDING_TO_CART,
        to: ConversationState.ADDING_TO_CART,
        trigger: StateTrigger.ADD_TO_CART,
      },
      {
        from: ConversationState.ADDING_TO_CART,
        to: ConversationState.ADDING_TO_CART,
        trigger: StateTrigger.REMOVE_FROM_CART,
      },

      // From REVIEWING_ORDER
      {
        from: ConversationState.REVIEWING_ORDER,
        to: ConversationState.ADDING_TO_CART,
        trigger: StateTrigger.ADD_TO_CART,
      },
      {
        from: ConversationState.REVIEWING_ORDER,
        to: ConversationState.AWAITING_PAYMENT,
        trigger: StateTrigger.CONFIRM_ORDER,
        condition: (context) => {
          const currentOrder = context[ContextKey.CURRENT_ORDER];
          return (
            currentOrder &&
            currentOrder.items &&
            currentOrder.items.length > 0 &&
            currentOrder.totalAmount &&
            currentOrder.totalAmount > 0
          );
        },
        action: (context) => {
          // Generate payment reference when confirming order
          const paymentReference = this.generatePaymentReference();
          return {
            ...context,
            [ContextKey.PAYMENT_REFERENCE]: paymentReference,
          };
        },
      },
      {
        from: ConversationState.REVIEWING_ORDER,
        to: ConversationState.BROWSING_PRODUCTS,
        trigger: StateTrigger.VIEW_PRODUCTS,
      },
      {
        from: ConversationState.REVIEWING_ORDER,
        to: ConversationState.GREETING,
        trigger: StateTrigger.CANCEL_ORDER,
        action: (context) => {
          // Clear order when cancelling
          const { [ContextKey.CURRENT_ORDER]: removed, ...cleanContext } =
            context;
          return cleanContext;
        },
      },

      // From AWAITING_PAYMENT
      {
        from: ConversationState.AWAITING_PAYMENT,
        to: ConversationState.PAYMENT_CONFIRMATION,
        trigger: StateTrigger.CONFIRM_PAYMENT,
        condition: (context) => {
          return context[ContextKey.PAYMENT_REFERENCE] !== undefined;
        },
      },
      {
        from: ConversationState.AWAITING_PAYMENT,
        to: ConversationState.REVIEWING_ORDER,
        trigger: StateTrigger.GO_BACK,
      },
      {
        from: ConversationState.AWAITING_PAYMENT,
        to: ConversationState.GREETING,
        trigger: StateTrigger.CANCEL_ORDER,
        action: (context) => {
          // Clear order and payment reference when cancelling
          const {
            [ContextKey.CURRENT_ORDER]: removedOrder,
            [ContextKey.PAYMENT_REFERENCE]: removedRef,
            ...cleanContext
          } = context;
          return cleanContext;
        },
      },
      {
        from: ConversationState.AWAITING_PAYMENT,
        to: ConversationState.GREETING,
        trigger: StateTrigger.PAYMENT_TIMEOUT,
        action: (context) => {
          // Clear order on timeout
          const { [ContextKey.CURRENT_ORDER]: removed, ...cleanContext } =
            context;
          return {
            ...cleanContext,
            [ContextKey.ERROR_COUNT]:
              (context[ContextKey.ERROR_COUNT] || 0) + 1,
          };
        },
      },

      // From PAYMENT_CONFIRMATION
      {
        from: ConversationState.PAYMENT_CONFIRMATION,
        to: ConversationState.ORDER_COMPLETE,
        trigger: StateTrigger.PAYMENT_VERIFIED,
      },
      {
        from: ConversationState.PAYMENT_CONFIRMATION,
        to: ConversationState.AWAITING_PAYMENT,
        trigger: StateTrigger.PAYMENT_FAILED,
        action: (context) => {
          return {
            ...context,
            [ContextKey.RETRY_COUNT]:
              (context[ContextKey.RETRY_COUNT] || 0) + 1,
          };
        },
      },
      {
        from: ConversationState.PAYMENT_CONFIRMATION,
        to: ConversationState.GREETING,
        trigger: StateTrigger.CANCEL_ORDER,
        action: (context) => {
          const {
            [ContextKey.CURRENT_ORDER]: removedOrder,
            [ContextKey.PAYMENT_REFERENCE]: removedRef,
            ...cleanContext
          } = context;
          return cleanContext;
        },
      },

      // From ORDER_COMPLETE
      {
        from: ConversationState.ORDER_COMPLETE,
        to: ConversationState.GREETING,
        trigger: StateTrigger.START_OVER,
        action: (context) => {
          // Clear all order-related context
          const {
            [ContextKey.CURRENT_ORDER]: removedOrder,
            [ContextKey.PAYMENT_REFERENCE]: removedRef,
            [ContextKey.SELECTED_PRODUCTS]: removedProducts,
            ...cleanContext
          } = context;
          return cleanContext;
        },
      },
      {
        from: ConversationState.ORDER_COMPLETE,
        to: ConversationState.BROWSING_PRODUCTS,
        trigger: StateTrigger.VIEW_PRODUCTS,
        action: (context) => {
          // Clear previous order but keep customer info
          const {
            [ContextKey.CURRENT_ORDER]: removedOrder,
            [ContextKey.PAYMENT_REFERENCE]: removedRef,
            [ContextKey.SELECTED_PRODUCTS]: removedProducts,
            ...cleanContext
          } = context;
          return cleanContext;
        },
      },

      // Global transitions (from any state)
      {
        from: ConversationState.GREETING,
        to: ConversationState.GREETING,
        trigger: StateTrigger.START_OVER,
      },
      {
        from: ConversationState.BROWSING_PRODUCTS,
        to: ConversationState.GREETING,
        trigger: StateTrigger.START_OVER,
      },
      {
        from: ConversationState.ADDING_TO_CART,
        to: ConversationState.GREETING,
        trigger: StateTrigger.START_OVER,
      },
      {
        from: ConversationState.REVIEWING_ORDER,
        to: ConversationState.GREETING,
        trigger: StateTrigger.START_OVER,
      },
      {
        from: ConversationState.AWAITING_PAYMENT,
        to: ConversationState.GREETING,
        trigger: StateTrigger.START_OVER,
      },
      {
        from: ConversationState.PAYMENT_CONFIRMATION,
        to: ConversationState.GREETING,
        trigger: StateTrigger.START_OVER,
      },
    ];

    return {
      initialState: ConversationState.GREETING,
      states,
      transitions,
    };
  }

  /** Validate if a state transition is allowed */
  canTransition(
    fromState: ConversationState,
    toState: ConversationState,
    trigger: StateTrigger,
    context: Record<string, any> = {}
  ): boolean {
    try {
      // Check if the target state is in allowed transitions
      const stateDefinition = this.getStateDefinition(fromState);
      if (!stateDefinition?.allowedTransitions.includes(toState)) {
        return false;
      }

      // Find matching transition
      const transition = this.config.transitions.find(
        (t) => t.from === fromState && t.to === toState && t.trigger === trigger
      );

      if (!transition) {
        return false;
      }

      // Check condition if present
      if (transition.condition) {
        return transition.condition(context);
      }

      return true;
    } catch (error) {
      this.logger.error("Error checking transition validity", {
        fromState,
        toState,
        trigger,
        error: error.message,
      });
      return false;
    }
  }

  /** Execute a state transition */
  executeTransition(
    fromState: ConversationState,
    trigger: StateTrigger,
    context: Record<string, any> = {}
  ): TransitionResult {
    try {
      // Find all possible transitions from current state with the given trigger
      const possibleTransitions = this.config.transitions.filter(
        (t) => t.from === fromState && t.trigger === trigger
      );

      if (possibleTransitions.length === 0) {
        return {
          success: false,
          error: `No transition found from ${fromState} with trigger ${trigger}`,
        };
      }

      // Find the first valid transition
      for (const transition of possibleTransitions) {
        if (this.canTransition(fromState, transition.to, trigger, context)) {
          let newContext = { ...context };

          // Execute action if present
          if (transition.action) {
            newContext = transition.action(newContext);
          }

          this.logger.debug("State transition executed", {
            from: fromState,
            to: transition.to,
            trigger,
          });

          return {
            success: true,
            newState: transition.to,
            context: newContext,
          };
        }
      }

      return {
        success: false,
        error: `Transition conditions not met from ${fromState} with trigger ${trigger}`,
      };
    } catch (error) {
      this.logger.error("Error executing transition", {
        fromState,
        trigger,
        error: error.message,
      });

      return {
        success: false,
        error: `Transition execution failed: ${error.message}`,
      };
    }
  }

  /** Get state definition */
  getStateDefinition(state: ConversationState): StateDefinition | undefined {
    return this.config.states.find((s) => s.state === state);
  }

  /** Get all allowed transitions from a state */
  getAllowedTransitions(state: ConversationState): ConversationState[] {
    const stateDefinition = this.getStateDefinition(state);
    return stateDefinition?.allowedTransitions || [];
  }

  /** Check if a state is terminal */
  isTerminalState(state: ConversationState): boolean {
    const stateDefinition = this.getStateDefinition(state);
    return stateDefinition?.isTerminal || false;
  }

  /** Get state timeout */
  getStateTimeout(state: ConversationState): number | undefined {
    const stateDefinition = this.getStateDefinition(state);
    return stateDefinition?.timeout;
  }

  /** Validate state machine configuration */
  validateConfiguration(): ValidationResult {
    const errors: string[] = [];

    // Check if all states are defined
    const definedStates = new Set(this.config.states.map((s) => s.state));
    const allStates = new Set(Object.values(ConversationState));

    for (const state of allStates) {
      if (!definedStates.has(state)) {
        errors.push(`State ${state} is not defined in configuration`);
      }
    }

    // Check if all transitions reference valid states
    for (const transition of this.config.transitions) {
      if (!definedStates.has(transition.from)) {
        errors.push(
          `Transition references undefined from state: ${transition.from}`
        );
      }
      if (!definedStates.has(transition.to)) {
        errors.push(
          `Transition references undefined to state: ${transition.to}`
        );
      }
    }

    // Check if allowed transitions in state definitions are valid
    for (const stateDefinition of this.config.states) {
      for (const allowedTransition of stateDefinition.allowedTransitions) {
        if (!definedStates.has(allowedTransition)) {
          errors.push(
            `State ${stateDefinition.state} allows transition to undefined state: ${allowedTransition}`
          );
        }
      }
    }

    return {
      isValid: errors.length === 0,
      errors,
    };
  }

  /** Get initial state */
  getInitialState(): ConversationState {
    return this.config.initialState;
  }

  /** Generate a unique payment reference */
  private generatePaymentReference(): string {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substring(2, 8);
    return `PAY-${timestamp}-${random}`.toUpperCase();
  }

  /** Get all available triggers for a state */
  getAvailableTriggers(state: ConversationState): StateTrigger[] {
    const triggers = this.config.transitions
      .filter((t) => t.from === state)
      .map((t) => t.trigger as StateTrigger);

    return [...new Set(triggers)]; // Remove duplicates
  }

  /** Get state machine statistics */
  getStateMachineStats(): {
    totalStates: number;
    totalTransitions: number;
    terminalStates: number;
    averageTransitionsPerState: number;
  } {
    const totalStates = this.config.states.length;
    const totalTransitions = this.config.transitions.length;
    const terminalStates = this.config.states.filter(
      (s) => s.isTerminal
    ).length;
    const averageTransitionsPerState = totalTransitions / totalStates;

    return {
      totalStates,
      totalTransitions,
      terminalStates,
      averageTransitionsPerState:
        Math.round(averageTransitionsPerState * 100) / 100,
    };
  }
}
