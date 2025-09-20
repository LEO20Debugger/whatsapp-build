import { Injectable, Logger } from "@nestjs/common";
import { eq, desc, asc, and, gte, lte } from "drizzle-orm";
import { DatabaseService } from "../../../database/database.service";
import { conversationSessions } from "../../../database/schema";
import {
  ConversationSession,
  NewConversationSession,
  UpdateConversationSession,
  CreateConversationSession,
  ConversationState,
  SessionMetrics,
  ConversationSessionRepository as IConversationSessionRepository,
} from "../../../database/types";

export interface ConversationSessionSearchOptions {
  limit?: number;
  offset?: number;
  sortBy?: "lastActivity" | "createdAt" | "phoneNumber";
  sortOrder?: "asc" | "desc";
  state?: ConversationState;
  startDate?: Date;
  endDate?: Date;
  activeOnly?: boolean;
}

@Injectable()
export class ConversationSessionRepository implements IConversationSessionRepository {
  private readonly logger = new Logger(ConversationSessionRepository.name);

  constructor(private readonly databaseService: DatabaseService) {}

  async create(sessionData: CreateConversationSession): Promise<ConversationSession> {
    try {
      const [session] = await this.databaseService.db
        .insert(conversationSessions)
        .values(sessionData)
        .returning();

      this.logger.log(`Created conversation session for phone: ${session.phoneNumber}`);
      return session;
    } catch (error) {
      this.logger.error(`Failed to create conversation session: ${error.message}`);
      throw error;
    }
  }

  async findByPhoneNumber(phoneNumber: string): Promise<ConversationSession | null> {
    try {
      const [session] = await this.databaseService.db
        .select()
        .from(conversationSessions)
        .where(eq(conversationSessions.phoneNumber, phoneNumber))
        .orderBy(desc(conversationSessions.lastActivity))
        .limit(1);

      return session || null;
    } catch (error) {
      this.logger.error(`Failed to find session by phone number ${phoneNumber}: ${error.message}`);
      throw error;
    }
  }

  async findById(id: string): Promise<ConversationSession | null> {
    try {
      const [session] = await this.databaseService.db
        .select()
        .from(conversationSessions)
        .where(eq(conversationSessions.id, id))
        .limit(1);

      return session || null;
    } catch (error) {
      this.logger.error(`Failed to find session by ID ${id}: ${error.message}`);
      throw error;
    }
  }

  async update(id: string, updates: UpdateConversationSession): Promise<ConversationSession> {
    try {
      const [session] = await this.databaseService.db
        .update(conversationSessions)
        .set(updates)
        .where(eq(conversationSessions.id, id))
        .returning();

      if (!session) {
        throw new Error(`Conversation session with ID ${id} not found`);
      }

      this.logger.log(`Updated conversation session ${id}`);
      return session;
    } catch (error) {
      this.logger.error(`Failed to update session ${id}: ${error.message}`);
      throw error;
    }
  }

  async delete(id: string): Promise<boolean> {
    try {
      const result = await this.databaseService.db
        .delete(conversationSessions)
        .where(eq(conversationSessions.id, id));

      // For postgres-js, result is an array with count property
      const deleted = (result as any).count > 0;
      if (deleted) {
        this.logger.log(`Deleted conversation session with ID: ${id}`);
      } else {
        this.logger.warn(`Conversation session with ID ${id} not found for deletion`);
      }

      return deleted;
    } catch (error) {
      this.logger.error(`Failed to delete session ${id}: ${error.message}`);
      throw error;
    }
  }

  // Analytics queries
  async findActiveSessions(): Promise<ConversationSession[]> {
    try {
      const now = new Date();
      const sessions = await this.databaseService.db
        .select()
        .from(conversationSessions)
        .where(gte(conversationSessions.expiresAt, now))
        .orderBy(desc(conversationSessions.lastActivity));

      this.logger.log(`Found ${sessions.length} active sessions`);
      return sessions;
    } catch (error) {
      this.logger.error(`Failed to find active sessions: ${error.message}`);
      throw error;
    }
  }

  async findByDateRange(startDate: Date, endDate: Date): Promise<ConversationSession[]> {
    try {
      const sessions = await this.databaseService.db
        .select()
        .from(conversationSessions)
        .where(
          and(
            gte(conversationSessions.createdAt, startDate),
            lte(conversationSessions.createdAt, endDate)
          )
        )
        .orderBy(desc(conversationSessions.createdAt));

      this.logger.log(`Found ${sessions.length} sessions in date range`);
      return sessions;
    } catch (error) {
      this.logger.error(`Failed to find sessions by date range: ${error.message}`);
      throw error;
    }
  }

  async getSessionsByState(state: ConversationState): Promise<ConversationSession[]> {
    try {
      const sessions = await this.databaseService.db
        .select()
        .from(conversationSessions)
        .where(eq(conversationSessions.currentState, state))
        .orderBy(desc(conversationSessions.lastActivity));

      this.logger.log(`Found ${sessions.length} sessions in state: ${state}`);
      return sessions;
    } catch (error) {
      this.logger.error(`Failed to find sessions by state ${state}: ${error.message}`);
      throw error;
    }
  }

  async getSessionMetrics(timeframe: 'day' | 'week' | 'month'): Promise<SessionMetrics> {
    try {
      // Calculate date range based on timeframe
      const now = new Date();
      const startDate = new Date();
      
      switch (timeframe) {
        case 'day':
          startDate.setDate(now.getDate() - 1);
          break;
        case 'week':
          startDate.setDate(now.getDate() - 7);
          break;
        case 'month':
          startDate.setMonth(now.getMonth() - 1);
          break;
      }

      // Get all sessions in timeframe
      const allSessions = await this.findByDateRange(startDate, now);
      const activeSessions = await this.findActiveSessions();

      // Calculate metrics
      const totalSessions = allSessions.length;
      const activeSessionsCount = activeSessions.length;
      
      // Count completed orders (sessions that reached order_complete state)
      const completedOrders = allSessions.filter(
        session => session.currentState === 'order_complete'
      ).length;

      // Calculate average duration (in minutes)
      const sessionsWithDuration = allSessions.filter(session => {
        const duration = session.updatedAt.getTime() - session.createdAt.getTime();
        return duration > 0;
      });
      
      const averageDuration = sessionsWithDuration.length > 0
        ? sessionsWithDuration.reduce((sum, session) => {
            return sum + (session.updatedAt.getTime() - session.createdAt.getTime());
          }, 0) / sessionsWithDuration.length / (1000 * 60) // Convert to minutes
        : 0;

      // Calculate conversion rate
      const conversionRate = totalSessions > 0 ? (completedOrders / totalSessions) * 100 : 0;

      // Count sessions by state
      const sessionsByState = allSessions.reduce((acc, session) => {
        acc[session.currentState] = (acc[session.currentState] || 0) + 1;
        return acc;
      }, {} as Record<ConversationState, number>);

      const metrics: SessionMetrics = {
        totalSessions,
        activeSessions: activeSessionsCount,
        completedOrders,
        averageDuration,
        conversionRate,
        sessionsByState,
      };

      this.logger.log(`Generated session metrics for ${timeframe}: ${JSON.stringify(metrics)}`);
      return metrics;
    } catch (error) {
      this.logger.error(`Failed to get session metrics: ${error.message}`);
      throw error;
    }
  }

  // Additional utility methods for basic session queries
  async findAll(options: ConversationSessionSearchOptions = {}): Promise<ConversationSession[]> {
    try {
      const {
        limit = 50,
        offset = 0,
        sortBy = "lastActivity",
        sortOrder = "desc",
        state,
        startDate,
        endDate,
        activeOnly = false,
      } = options;

      let whereConditions = [];

      // Add state filter
      if (state) {
        whereConditions.push(eq(conversationSessions.currentState, state));
      }

      // Add date range filters
      if (startDate) {
        whereConditions.push(gte(conversationSessions.createdAt, startDate));
      }
      if (endDate) {
        whereConditions.push(lte(conversationSessions.createdAt, endDate));
      }

      // Add active filter
      if (activeOnly) {
        const now = new Date();
        whereConditions.push(gte(conversationSessions.expiresAt, now));
      }

      const sortColumn = conversationSessions[sortBy];
      const orderByClause = sortOrder === "asc" ? asc(sortColumn) : desc(sortColumn);

      const baseQuery = this.databaseService.db.select().from(conversationSessions);

      const sessionList = await (
        whereConditions.length > 0
          ? baseQuery.where(and(...whereConditions))
          : baseQuery
      )
        .orderBy(orderByClause)
        .limit(limit)
        .offset(offset);

      return sessionList;
    } catch (error) {
      this.logger.error(`Failed to find sessions: ${error.message}`);
      throw error;
    }
  }

  async count(options: ConversationSessionSearchOptions = {}): Promise<number> {
    try {
      const {
        state,
        startDate,
        endDate,
        activeOnly = false,
      } = options;

      let whereConditions = [];

      // Add state filter
      if (state) {
        whereConditions.push(eq(conversationSessions.currentState, state));
      }

      // Add date range filters
      if (startDate) {
        whereConditions.push(gte(conversationSessions.createdAt, startDate));
      }
      if (endDate) {
        whereConditions.push(lte(conversationSessions.createdAt, endDate));
      }

      // Add active filter
      if (activeOnly) {
        const now = new Date();
        whereConditions.push(gte(conversationSessions.expiresAt, now));
      }

      const baseQuery = this.databaseService.db.select().from(conversationSessions);

      const result = await (whereConditions.length > 0
        ? baseQuery.where(and(...whereConditions))
        : baseQuery);
      
      return result.length;
    } catch (error) {
      this.logger.error(`Failed to count sessions: ${error.message}`);
      throw error;
    }
  }

  async exists(id: string): Promise<boolean> {
    try {
      const session = await this.findById(id);
      return session !== null;
    } catch (error) {
      this.logger.error(`Failed to check if session exists ${id}: ${error.message}`);
      throw error;
    }
  }

  async isActive(id: string): Promise<boolean> {
    try {
      const session = await this.findById(id);
      if (!session) return false;
      
      const now = new Date();
      return session.expiresAt > now;
    } catch (error) {
      this.logger.error(`Failed to check if session is active ${id}: ${error.message}`);
      throw error;
    }
  }
}