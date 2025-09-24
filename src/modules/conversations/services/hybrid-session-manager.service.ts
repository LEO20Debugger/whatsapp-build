import { Injectable, Logger } from "@nestjs/common";
import { RedisService } from "../../../common/redis/redis.service";
import { ConversationSessionRepository } from "../repositories/conversation-session.repository";
import {
  ConversationSession,
  ConversationState,
} from "../types/conversation.types";
import {
  ConversationSession as DbConversationSession,
  CreateConversationSession,
  UpdateConversationSession,
  HybridSessionManager as IHybridSessionManager,
  ConversationState as DbConversationState,
} from "../../../database/types";

@Injectable()
export class HybridSessionManager {
  private readonly logger = new Logger(HybridSessionManager.name);
  private readonly defaultTtl = 600; // 10 minutes
  private readonly keyPrefix = "conversation:session:";
  private readonly maxRetryAttempts = 3;
  private readonly retryDelay = 1000; // 1 second

  constructor(
    private readonly redisService: RedisService,
    private readonly sessionRepository: ConversationSessionRepository
  ) {}

  /** Get session with write-through caching strategy and auto-create if expired */
  async getSession(phoneNumber: string): Promise<ConversationSession> {
    try {
      this.logger.debug(`Getting session for phone number: ${phoneNumber}`);

      // Try Redis first
      let session = await this.getSessionFromRedis(phoneNumber);
      if (session) {
        if (this.isExpired(session)) {
          this.logger.debug(
            `Redis session expired for phone number: ${phoneNumber}`
          );
          await this.deleteSession(phoneNumber); // Remove expired session
          session = null;
        } else {
          this.logger.debug(
            `Session retrieved from Redis for phone number: ${phoneNumber}`,
            {
              lastActivity: session.lastActivity,
              state: session.currentState,
            }
          );
          return session;
        }
      }

      // Fallback to database
      if (!session) {
        const dbSession = await this.getSessionFromDatabase(phoneNumber);
        if (
          dbSession &&
          (!dbSession.expiresAt || new Date() <= dbSession.expiresAt)
        ) {
          session = this.convertDbSessionToConversationSession(dbSession);
          await this.saveSessionToRedis(session);
          this.logger.debug(
            `Session restored from database to Redis for phone number: ${phoneNumber}`,
            {
              lastActivity: session.lastActivity,
              state: session.currentState,
            }
          );
          return session;
        } else if (dbSession) {
          this.logger.debug(
            `Database session expired for phone number: ${phoneNumber}`
          );
          await this.deleteSession(phoneNumber);
        }
      }

      // Auto-create session if not found or expired
      session = await this.createSession(phoneNumber);
      this.logger.log(
        `Auto-created new session for phone number: ${phoneNumber}`
      );
      return session;
    } catch (error) {
      this.logger.error(
        `Failed to get session for ${phoneNumber}: ${error.message}`
      );

      // Fallback to database if Redis fails
      try {
        const dbSession = await this.getSessionFromDatabase(phoneNumber);
        if (dbSession)
          return this.convertDbSessionToConversationSession(dbSession);
      } catch (dbError) {
        this.logger.error(
          `Database fallback also failed for ${phoneNumber}: ${dbError.message}`
        );
      }

      // As last resort, create a new session
      return await this.createSession(phoneNumber);
    }
  }

  /** Create session with write-through caching */
  async createSession(
    phoneNumber: string,
    initialState: ConversationState = ConversationState.GREETING,
    customerId?: string
  ): Promise<ConversationSession> {
    try {
      this.logger.log(`Creating new session for phone number: ${phoneNumber}`);

      const now = new Date();
      const expiresAt = new Date(now.getTime() + this.defaultTtl * 1000);

      // Create in-memory session object
      const session: ConversationSession = {
        phoneNumber,
        currentState: initialState,
        lastActivity: now,
        context: {},
      };

      // Save to database first (source of truth)
      const dbSessionData: CreateConversationSession = {
        phoneNumber,
        customerId,
        currentState: this.convertConversationStateToDbState(initialState),
        context: {}, // empty JSON by default
        lastActivity: now,
        expiresAt,
      };

      await this.sessionRepository.create(dbSessionData);

      // Save to Redis for performance
      await this.saveSessionToRedis(session);

      this.logger.log(
        `Successfully created session for: ${phoneNumber}${customerId ? ` with customer ID: ${customerId}` : ""}`
      );
      return session;
    } catch (error) {
      this.logger.error(
        `Failed to create session for ${phoneNumber}: ${error.message}`
      );
      throw error;
    }
  }

  /** Update session with write-through caching */
  async updateSession(
    session: ConversationSession,
    customerId?: string
  ): Promise<boolean> {
    try {
      this.logger.debug(
        `Updating session for phone number: ${session.phoneNumber}`
      );

      // Update last activity
      session.lastActivity = new Date();

      // Update database first (source of truth)
      const dbSession = await this.getSessionFromDatabase(session.phoneNumber);
      if (dbSession) {
        const updates: UpdateConversationSession = {
          context: session.context,
          lastActivity: session.lastActivity,
          currentState: this.convertConversationStateToDbState(
            session.currentState
          ),
          expiresAt: new Date(
            session.lastActivity.getTime() + this.defaultTtl * 1000
          ),
          ...(customerId ? { customerId } : {}),
        };

        await this.sessionRepository.update(dbSession.id, updates);
      }

      // Update Redis cache
      await this.saveSessionToRedis(session);

      this.logger.debug(
        `Successfully updated session for: ${session.phoneNumber}${customerId ? ` with customer ID: ${customerId}` : ""}`
      );
      return true;
    } catch (error) {
      this.logger.error(
        `Failed to update session for ${session.phoneNumber}: ${error.message}`
      );

      // If database fails but Redis succeeds, log warning but continue
      if (
        error.message.includes("database") ||
        error.message.includes("Database")
      ) {
        this.logger.warn(
          `Database update failed for ${session.phoneNumber}, but Redis cache updated`
        );
        return true;
      }

      return false;
    }
  }

  /* Update session with customer ID */
  async updateSessionCustomerId(
    phoneNumber: string,
    customerId: string
  ): Promise<boolean> {
    try {
      this.logger.debug(`Updating customer ID for session: ${phoneNumber}`);

      const dbSession = await this.getSessionFromDatabase(phoneNumber);
      if (!dbSession) {
        this.logger.warn(
          `No session found in database for phone number: ${phoneNumber}`
        );
        return false;
      }

      await this.sessionRepository.update(dbSession.id, { customerId });

      // Also update Redis if session exists
      const redisSession = await this.getSessionFromRedis(phoneNumber);
      if (redisSession) {
        redisSession.customerId = customerId;
        await this.saveSessionToRedis(redisSession);
      }

      this.logger.debug(
        `Successfully updated customer ID for session: ${phoneNumber}`
      );
      return true;
    } catch (error) {
      this.logger.error(
        `Failed to update customer ID for ${phoneNumber}: ${error.message}`
      );
      return false;
    }
  }

  /** Delete session from both Redis and database */
  async deleteSession(phoneNumber: string): Promise<boolean> {
    try {
      this.logger.debug(`Deleting session for phone number: ${phoneNumber}`);

      let success = true;

      // Delete from Redis
      try {
        const key = this.getSessionKey(phoneNumber);
        await this.redisService.del(key);
      } catch (error) {
        this.logger.warn(
          `Failed to delete from Redis for ${phoneNumber}: ${error.message}`
        );
        success = false;
      }

      // Delete from database
      try {
        const dbSession = await this.getSessionFromDatabase(phoneNumber);
        if (dbSession) {
          await this.sessionRepository.delete(dbSession.id);
        }
      } catch (error) {
        this.logger.warn(
          `Failed to delete from database for ${phoneNumber}: ${error.message}`
        );
        success = false;
      }

      if (success) {
        this.logger.debug(`Successfully deleted session for: ${phoneNumber}`);
      }

      return success;
    } catch (error) {
      this.logger.error(
        `Failed to delete session for ${phoneNumber}: ${error.message}`
      );
      return false;
    }
  }

  /** Restore session from database when Redis is unavailable */
  async restoreSessionFromDatabase(
    phoneNumber: string
  ): Promise<ConversationSession | null> {
    try {
      this.logger.debug(`Restoring session from database for: ${phoneNumber}`);

      const dbSession = await this.getSessionFromDatabase(phoneNumber);
      if (!dbSession) {
        return null;
      }

      const session = this.convertDbSessionToConversationSession(dbSession);

      // Try to restore to Redis if available
      if (this.redisService.isRedisAvailable()) {
        await this.saveSessionToRedis(session);
        this.logger.debug(`Session restored to Redis for: ${phoneNumber}`);
      }

      return session;
    } catch (error) {
      this.logger.error(
        `Failed to restore session from database for ${phoneNumber}: ${error.message}`
      );
      return null;
    }
  }

  /** Sync active sessions from Redis to database */
  async syncActiveSessionsToDatabase(): Promise<number> {
    if (!this.redisService.isRedisAvailable()) return 0;

    const keys = await this.redisService.keys(`${this.keyPrefix}*`);
    let syncedCount = 0;

    for (const key of keys) {
      const phoneNumber = key.replace(this.keyPrefix, "");
      const redisSession = await this.getSessionFromRedis(phoneNumber);
      if (!redisSession || this.isExpired(redisSession)) continue;

      const dbSession = await this.getSessionFromDatabase(phoneNumber);
      const updates: UpdateConversationSession = {
        context: redisSession.context,
        lastActivity: redisSession.lastActivity,
        expiresAt: new Date(
          redisSession.lastActivity.getTime() + this.defaultTtl * 1000
        ),
      };

      if (dbSession) {
        await this.sessionRepository.update(dbSession.id, updates);
      } else {
        await this.sessionRepository.create({
          phoneNumber,
          expiresAt: updates.expiresAt,
        });
      }

      syncedCount++;
    }

    this.logger.log(`Successfully synced ${syncedCount} active sessions to DB`);
    return syncedCount;
  }

  /** Get session history from database */
  async getSessionHistory(
    phoneNumber: string,
    limit: number = 10
  ): Promise<ConversationSession[]> {
    try {
      // This would require additional database queries to get historical sessions
      // For now, return the current session if it exists
      const currentSession = await this.getSession(phoneNumber);
      return currentSession ? [currentSession] : [];
    } catch (error) {
      this.logger.error(
        `Failed to get session history for ${phoneNumber}: ${error.message}`
      );
      return [];
    }
  }

  /** Get count of active sessions */
  async getActiveSessionsCount(): Promise<number> {
    try {
      // Try Redis first for performance
      if (this.redisService.isRedisAvailable()) {
        const pattern = `${this.keyPrefix}*`;
        const keys = await this.redisService.keys(pattern);
        return keys.length;
      }

      // Fallback to database
      const activeSessions = await this.sessionRepository.findActiveSessions();
      return activeSessions.length;
    } catch (error) {
      this.logger.error(
        `Failed to get active sessions count: ${error.message}`
      );
      return 0;
    }
  }

  // Private helpers
  private async getSessionFromRedis(
    phoneNumber: string
  ): Promise<ConversationSession | null> {
    try {
      if (!this.redisService.isRedisAvailable()) {
        return null;
      }

      const key = this.getSessionKey(phoneNumber);
      const sessionData = await this.redisService.get(key);

      if (!sessionData) {
        return null;
      }

      const session = JSON.parse(sessionData) as ConversationSession;
      // Convert lastActivity back to Date object
      session.lastActivity = new Date(session.lastActivity);

      return session;
    } catch (error) {
      this.logger.warn(
        `Failed to get session from Redis for ${phoneNumber}: ${error.message}`
      );
      return null;
    }
  }

  private async saveSessionToRedis(
    session: ConversationSession
  ): Promise<boolean> {
    try {
      if (!this.redisService.isRedisAvailable()) {
        this.logger.debug("Redis not available, skipping cache update");
        return false;
      }

      const key = this.getSessionKey(session.phoneNumber);
      const sessionData = JSON.stringify(session);

      return await this.redisService.set(key, sessionData, this.defaultTtl);
    } catch (error) {
      this.logger.warn(
        `Failed to save session to Redis for ${session.phoneNumber}: ${error.message}`
      );
      return false;
    }
  }

  /** Check if a session is expired based on last activity and TTL */
  private isExpired(session: ConversationSession): boolean {
    return session.lastActivity.getTime() + this.defaultTtl * 1000 < Date.now();
  }

  private async getSessionFromDatabase(
    phoneNumber: string
  ): Promise<DbConversationSession | null> {
    try {
      return await this.sessionRepository.findByPhoneNumber(phoneNumber);
    } catch (error) {
      this.logger.warn(
        `Failed to get session from database for ${phoneNumber}: ${error.message}`
      );
      return null;
    }
  }

  private convertDbSessionToConversationSession(
    dbSession: DbConversationSession
  ): ConversationSession {
    // Map database state to conversation state
    const stateMapping: Record<string, ConversationState> = {
      greeting: ConversationState.GREETING,
      browsing_products: ConversationState.BROWSING_PRODUCTS,
      adding_to_cart: ConversationState.ADDING_TO_CART,
      reviewing_order: ConversationState.REVIEWING_ORDER,
      awaiting_payment: ConversationState.AWAITING_PAYMENT,
      payment_confirmation: ConversationState.PAYMENT_CONFIRMATION,
      order_complete: ConversationState.ORDER_COMPLETE,
    };

    const currentState =
      stateMapping[dbSession.currentState] || ConversationState.GREETING;

    return {
      phoneNumber: dbSession.phoneNumber,
      currentState,
      lastActivity: dbSession.lastActivity,
      context: (dbSession.context as Record<string, any>) || {},
    };
  }

  private getSessionKey(phoneNumber: string): string {
    return `${this.keyPrefix}${phoneNumber}`;
  }

  private convertConversationStateToDbState(
    state: ConversationState
  ): DbConversationState {
    // Map conversation state to database state
    const stateMapping: Record<ConversationState, DbConversationState> = {
      [ConversationState.GREETING]: "greeting" as DbConversationState,
      [ConversationState.COLLECTING_NAME]: "greeting" as DbConversationState, // Map to closest equivalent
      [ConversationState.MAIN_MENU]: "greeting" as DbConversationState, // Map to closest equivalent
      [ConversationState.BROWSING_PRODUCTS]:
        "browsing_products" as DbConversationState,
      [ConversationState.ADDING_TO_CART]:
        "adding_to_cart" as DbConversationState,
      [ConversationState.COLLECTING_QUANTITY]:
        "adding_to_cart" as DbConversationState, // Map to closest equivalent
      [ConversationState.REVIEWING_ORDER]:
        "reviewing_order" as DbConversationState,
      [ConversationState.AWAITING_PAYMENT]:
        "awaiting_payment" as DbConversationState,
      [ConversationState.PAYMENT_CONFIRMATION]:
        "payment_confirmation" as DbConversationState,
      [ConversationState.ORDER_COMPLETE]:
        "order_complete" as DbConversationState,
    };

    return stateMapping[state] || ("greeting" as DbConversationState);
  }

  /** Retry mechanism for database operations */
  private async retryOperation<T>(
    operation: () => Promise<T>,
    operationName: string,
    maxAttempts: number = this.maxRetryAttempts
  ): Promise<T> {
    let lastError: Error;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error;

        if (attempt === maxAttempts) {
          break;
        }

        const delay = this.retryDelay * Math.pow(2, attempt - 1);
        this.logger.warn(
          `${operationName} failed on attempt ${attempt}/${maxAttempts}, retrying in ${delay}ms: ${error.message}`
        );

        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }

    throw lastError;
  }
}
