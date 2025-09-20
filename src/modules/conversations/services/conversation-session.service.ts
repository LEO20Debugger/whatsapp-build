import { Injectable, Logger } from "@nestjs/common";
import { RedisService } from "../../../common/redis/redis.service";
import { HybridSessionManager } from "./hybrid-session-manager.service";
import {
  ConversationSession,
  ConversationState,
  SessionStorageOptions,
} from "../types/conversation.types";

@Injectable()
export class ConversationSessionService {
  private readonly logger = new Logger(ConversationSessionService.name);
  private readonly defaultTtl = 3600; // 1 hour in seconds
  private readonly keyPrefix = "conversation:session:";

  constructor(
    private readonly redisService: RedisService,
    private readonly hybridSessionManager: HybridSessionManager,
  ) {}

  /**
   * Get conversation session for a phone number
   */
  async getSession(phoneNumber: string): Promise<ConversationSession | null> {
    try {
      // Use hybrid session manager for persistence
      const session = await this.hybridSessionManager.getSession(phoneNumber);

      if (session) {
        this.logger.debug(`Retrieved session for phone number: ${phoneNumber}`, {
          state: session.currentState,
          lastActivity: session.lastActivity,
        });
      } else {
        this.logger.debug(`No session found for phone number: ${phoneNumber}`);
      }

      return session;
    } catch (error) {
      this.logger.error(
        `Failed to get session for phone number: ${phoneNumber}`,
        { error: error.message },
      );
      return null;
    }
  }

  /**
   * Create or update conversation session
   */
  async setSession(
    session: ConversationSession,
    options: SessionStorageOptions = {},
  ): Promise<boolean> {
    try {
      // Update last activity
      session.lastActivity = new Date();

      // Use hybrid session manager for persistence
      const success = await this.hybridSessionManager.updateSession(session);

      if (success) {
        this.logger.debug(
          `Saved session for phone number: ${session.phoneNumber}`,
          {
            state: session.currentState,
          },
        );
      } else {
        this.logger.warn(
          `Failed to save session for phone number: ${session.phoneNumber}`,
        );
      }

      return success;
    } catch (error) {
      this.logger.error(
        `Failed to set session for phone number: ${session.phoneNumber}`,
        { error: error.message },
      );
      return false;
    }
  }

  /**
   * Create a new conversation session
   */
  async createSession(
    phoneNumber: string,
    initialState: ConversationState = ConversationState.GREETING,
    options: SessionStorageOptions = {},
    customerId?: string,
  ): Promise<ConversationSession | null> {
    try {
      // Use hybrid session manager for persistence
      const session = await this.hybridSessionManager.createSession(phoneNumber, initialState, customerId);

      if (session) {
        this.logger.log(
          `Created new session for phone number: ${phoneNumber}`,
          {
            initialState,
            customerId,
          },
        );
      }

      return session;
    } catch (error) {
      this.logger.error(
        `Failed to create session for phone number: ${phoneNumber}`,
        { error: error.message },
      );
      return null;
    }
  }

  /**
   * Update conversation state
   */
  async updateState(
    phoneNumber: string,
    newState: ConversationState,
    context?: Record<string, any>,
  ): Promise<boolean> {
    try {
      const session = await this.getSession(phoneNumber);

      if (!session) {
        this.logger.warn(
          `Cannot update state - no session found for phone number: ${phoneNumber}`,
        );
        return false;
      }

      const oldState = session.currentState;
      session.currentState = newState;

      if (context) {
        session.context = { ...session.context, ...context };
      }

      const success = await this.hybridSessionManager.updateSession(session);

      if (success) {
        this.logger.debug(`Updated state for phone number: ${phoneNumber}`, {
          oldState,
          newState,
          context,
        });
      }

      return success;
    } catch (error) {
      this.logger.error(
        `Failed to update state for phone number: ${phoneNumber}`,
        { error: error.message },
      );
      return false;
    }
  }

  /**
   * Update session context
   */
  async updateContext(
    phoneNumber: string,
    context: Record<string, any>,
  ): Promise<boolean> {
    try {
      const session = await this.getSession(phoneNumber);

      if (!session) {
        this.logger.warn(
          `Cannot update context - no session found for phone number: ${phoneNumber}`,
        );
        return false;
      }

      session.context = { ...session.context, ...context };
      const success = await this.hybridSessionManager.updateSession(session);

      if (success) {
        this.logger.debug(`Updated context for phone number: ${phoneNumber}`, {
          context,
        });
      }

      return success;
    } catch (error) {
      this.logger.error(
        `Failed to update context for phone number: ${phoneNumber}`,
        { error: error.message },
      );
      return false;
    }
  }

  /**
   * Delete conversation session
   */
  async deleteSession(phoneNumber: string): Promise<boolean> {
    try {
      const success = await this.hybridSessionManager.deleteSession(phoneNumber);

      if (success) {
        this.logger.debug(`Deleted session for phone number: ${phoneNumber}`);
      } else {
        this.logger.warn(
          `Failed to delete session for phone number: ${phoneNumber}`,
        );
      }

      return success;
    } catch (error) {
      this.logger.error(
        `Failed to delete session for phone number: ${phoneNumber}`,
        { error: error.message },
      );
      return false;
    }
  }

  /**
   * Check if session exists
   */
  async sessionExists(phoneNumber: string): Promise<boolean> {
    try {
      const key = this.getSessionKey(phoneNumber);
      return await this.redisService.exists(key);
    } catch (error) {
      this.logger.error(
        `Failed to check session existence for phone number: ${phoneNumber}`,
        { error: error.message },
      );
      return false;
    }
  }

  /**
   * Get session TTL (time to live)
   */
  async getSessionTtl(phoneNumber: string): Promise<number> {
    try {
      const key = this.getSessionKey(phoneNumber);
      return await this.redisService.ttl(key);
    } catch (error) {
      this.logger.error(`Failed to get TTL for phone number: ${phoneNumber}`, {
        error: error.message,
      });
      return -1;
    }
  }

  /**
   * Extend session expiration
   */
  async extendSession(
    phoneNumber: string,
    additionalSeconds: number = 3600,
  ): Promise<boolean> {
    try {
      const key = this.getSessionKey(phoneNumber);
      const currentTtl = await this.redisService.ttl(key);

      if (currentTtl <= 0) {
        this.logger.warn(
          `Cannot extend session - session not found or expired for phone number: ${phoneNumber}`,
        );
        return false;
      }

      const newTtl = currentTtl + additionalSeconds;
      const success = await this.redisService.expire(key, newTtl);

      if (success) {
        this.logger.debug(`Extended session for phone number: ${phoneNumber}`, {
          additionalSeconds,
          newTtl,
        });
      }

      return success;
    } catch (error) {
      this.logger.error(
        `Failed to extend session for phone number: ${phoneNumber}`,
        { error: error.message },
      );
      return false;
    }
  }

  /**
   * Get all active sessions (for admin/monitoring purposes)
   */
  async getActiveSessions(): Promise<string[]> {
    try {
      const pattern = `${this.keyPrefix}*`;
      const keys = await this.redisService.keys(pattern);

      // Extract phone numbers from keys
      const phoneNumbers = keys.map((key) => key.replace(this.keyPrefix, ""));

      this.logger.debug(`Found ${phoneNumbers.length} active sessions`);
      return phoneNumbers;
    } catch (error) {
      this.logger.error("Failed to get active sessions", {
        error: error.message,
      });
      return [];
    }
  }

  /**
   * Clean up expired sessions (manual cleanup if needed)
   */
  async cleanupExpiredSessions(): Promise<number> {
    try {
      const activePhoneNumbers = await this.getActiveSessions();
      let cleanedCount = 0;

      for (const phoneNumber of activePhoneNumbers) {
        const ttl = await this.getSessionTtl(phoneNumber);

        // If TTL is 0 or negative, the key is expired or doesn't exist
        if (ttl <= 0) {
          const deleted = await this.deleteSession(phoneNumber);
          if (deleted) {
            cleanedCount++;
          }
        }
      }

      if (cleanedCount > 0) {
        this.logger.log(`Cleaned up ${cleanedCount} expired sessions`);
      }

      return cleanedCount;
    } catch (error) {
      this.logger.error("Failed to cleanup expired sessions", {
        error: error.message,
      });
      return 0;
    }
  }

  /**
   * Get session statistics
   */
  async getSessionStats(): Promise<{
    totalSessions: number;
    sessionsByState: Record<ConversationState, number>;
  }> {
    try {
      const activePhoneNumbers = await this.getActiveSessions();
      const sessionsByState: Record<ConversationState, number> = {} as Record<
        ConversationState,
        number
      >;

      // Initialize counters
      Object.values(ConversationState).forEach((state) => {
        sessionsByState[state] = 0;
      });

      // Count sessions by state
      for (const phoneNumber of activePhoneNumbers) {
        const session = await this.getSession(phoneNumber);
        if (session) {
          sessionsByState[session.currentState]++;
        }
      }

      return {
        totalSessions: activePhoneNumbers.length,
        sessionsByState,
      };
    } catch (error) {
      this.logger.error("Failed to get session statistics", {
        error: error.message,
      });
      return {
        totalSessions: 0,
        sessionsByState: {} as Record<ConversationState, number>,
      };
    }
  }

  /**
   * Update session with customer ID
   */
  async updateSessionCustomerId(phoneNumber: string, customerId: string): Promise<boolean> {
    try {
      const success = await this.hybridSessionManager.updateSessionCustomerId(phoneNumber, customerId);

      if (success) {
        this.logger.debug(`Updated customer ID for phone number: ${phoneNumber}`, {
          customerId,
        });
      }

      return success;
    } catch (error) {
      this.logger.error(
        `Failed to update customer ID for phone number: ${phoneNumber}`,
        { error: error.message },
      );
      return false;
    }
  }

  /**
   * Generate Redis key for session
   */
  private getSessionKey(phoneNumber: string): string {
    return `${this.keyPrefix}${phoneNumber}`;
  }
}
