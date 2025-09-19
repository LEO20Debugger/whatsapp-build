import { Test, TestingModule } from '@nestjs/testing';
import { ConversationSessionService } from './conversation-session.service';
import { RedisService } from '../../../common/redis/redis.service';
import { ConversationState, ConversationSession } from '../types/conversation.types';

describe('ConversationSessionService', () => {
  let service: ConversationSessionService;
  let redisService: jest.Mocked<RedisService>;

  const mockPhoneNumber = '+1234567890';
  const mockSession: ConversationSession = {
    phoneNumber: mockPhoneNumber,
    currentState: ConversationState.GREETING,
    lastActivity: new Date('2023-01-01T12:00:00Z'),
    context: { testKey: 'testValue' },
  };

  beforeEach(async () => {
    const mockRedisService = {
      get: jest.fn(),
      set: jest.fn(),
      del: jest.fn(),
      exists: jest.fn(),
      expire: jest.fn(),
      ttl: jest.fn(),
      keys: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ConversationSessionService,
        {
          provide: RedisService,
          useValue: mockRedisService,
        },
      ],
    }).compile();

    service = module.get<ConversationSessionService>(ConversationSessionService);
    redisService = module.get<RedisService>(RedisService) as jest.Mocked<RedisService>;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getSession', () => {
    it('should return session when found in Redis', async () => {
      const sessionData = JSON.stringify(mockSession);
      redisService.get.mockResolvedValue(sessionData);

      const result = await service.getSession(mockPhoneNumber);

      expect(redisService.get).toHaveBeenCalledWith('conversation:session:+1234567890');
      expect(result).toEqual({
        ...mockSession,
        lastActivity: new Date('2023-01-01T12:00:00Z'),
      });
    });

    it('should return null when session not found', async () => {
      redisService.get.mockResolvedValue(null);

      const result = await service.getSession(mockPhoneNumber);

      expect(result).toBeNull();
    });

    it('should return null when Redis operation fails', async () => {
      redisService.get.mockRejectedValue(new Error('Redis error'));

      const result = await service.getSession(mockPhoneNumber);

      expect(result).toBeNull();
    });

    it('should handle invalid JSON data gracefully', async () => {
      redisService.get.mockResolvedValue('invalid json');

      const result = await service.getSession(mockPhoneNumber);

      expect(result).toBeNull();
    });
  });

  describe('setSession', () => {
    it('should save session successfully', async () => {
      redisService.set.mockResolvedValue(true);

      const result = await service.setSession(mockSession);

      expect(redisService.set).toHaveBeenCalledWith(
        'conversation:session:+1234567890',
        expect.stringContaining(mockPhoneNumber),
        3600
      );
      expect(result).toBe(true);
    });

    it('should use custom TTL when provided', async () => {
      redisService.set.mockResolvedValue(true);

      const result = await service.setSession(mockSession, { ttl: 7200 });

      expect(redisService.set).toHaveBeenCalledWith(
        'conversation:session:+1234567890',
        expect.any(String),
        7200
      );
      expect(result).toBe(true);
    });

    it('should return false when Redis operation fails', async () => {
      redisService.set.mockResolvedValue(false);

      const result = await service.setSession(mockSession);

      expect(result).toBe(false);
    });

    it('should handle Redis errors gracefully', async () => {
      redisService.set.mockRejectedValue(new Error('Redis error'));

      const result = await service.setSession(mockSession);

      expect(result).toBe(false);
    });
  });

  describe('createSession', () => {
    it('should create new session with default state', async () => {
      redisService.set.mockResolvedValue(true);

      const result = await service.createSession(mockPhoneNumber);

      expect(redisService.set).toHaveBeenCalled();
      expect(result).toMatchObject({
        phoneNumber: mockPhoneNumber,
        currentState: ConversationState.GREETING,
        context: {},
      });
      expect(result?.lastActivity).toBeInstanceOf(Date);
    });

    it('should create session with custom initial state', async () => {
      redisService.set.mockResolvedValue(true);

      const result = await service.createSession(
        mockPhoneNumber,
        ConversationState.BROWSING_PRODUCTS
      );

      expect(result?.currentState).toBe(ConversationState.BROWSING_PRODUCTS);
    });

    it('should return null when session creation fails', async () => {
      redisService.set.mockResolvedValue(false);

      const result = await service.createSession(mockPhoneNumber);

      expect(result).toBeNull();
    });
  });

  describe('updateState', () => {
    it('should update session state successfully', async () => {
      const sessionData = JSON.stringify(mockSession);
      redisService.get.mockResolvedValue(sessionData);
      redisService.set.mockResolvedValue(true);

      const result = await service.updateState(
        mockPhoneNumber,
        ConversationState.BROWSING_PRODUCTS,
        { newKey: 'newValue' }
      );

      expect(redisService.get).toHaveBeenCalled();
      expect(redisService.set).toHaveBeenCalled();
      expect(result).toBe(true);
    });

    it('should return false when session not found', async () => {
      redisService.get.mockResolvedValue(null);

      const result = await service.updateState(
        mockPhoneNumber,
        ConversationState.BROWSING_PRODUCTS
      );

      expect(result).toBe(false);
    });

    it('should handle Redis errors gracefully', async () => {
      redisService.get.mockRejectedValue(new Error('Redis error'));

      const result = await service.updateState(
        mockPhoneNumber,
        ConversationState.BROWSING_PRODUCTS
      );

      expect(result).toBe(false);
    });
  });

  describe('updateContext', () => {
    it('should update session context successfully', async () => {
      const sessionData = JSON.stringify(mockSession);
      redisService.get.mockResolvedValue(sessionData);
      redisService.set.mockResolvedValue(true);

      const result = await service.updateContext(mockPhoneNumber, {
        newKey: 'newValue',
      });

      expect(redisService.get).toHaveBeenCalled();
      expect(redisService.set).toHaveBeenCalled();
      expect(result).toBe(true);
    });

    it('should return false when session not found', async () => {
      redisService.get.mockResolvedValue(null);

      const result = await service.updateContext(mockPhoneNumber, {
        newKey: 'newValue',
      });

      expect(result).toBe(false);
    });
  });

  describe('deleteSession', () => {
    it('should delete session successfully', async () => {
      redisService.del.mockResolvedValue(true);

      const result = await service.deleteSession(mockPhoneNumber);

      expect(redisService.del).toHaveBeenCalledWith('conversation:session:+1234567890');
      expect(result).toBe(true);
    });

    it('should return false when deletion fails', async () => {
      redisService.del.mockResolvedValue(false);

      const result = await service.deleteSession(mockPhoneNumber);

      expect(result).toBe(false);
    });

    it('should handle Redis errors gracefully', async () => {
      redisService.del.mockRejectedValue(new Error('Redis error'));

      const result = await service.deleteSession(mockPhoneNumber);

      expect(result).toBe(false);
    });
  });

  describe('sessionExists', () => {
    it('should return true when session exists', async () => {
      redisService.exists.mockResolvedValue(true);

      const result = await service.sessionExists(mockPhoneNumber);

      expect(redisService.exists).toHaveBeenCalledWith('conversation:session:+1234567890');
      expect(result).toBe(true);
    });

    it('should return false when session does not exist', async () => {
      redisService.exists.mockResolvedValue(false);

      const result = await service.sessionExists(mockPhoneNumber);

      expect(result).toBe(false);
    });

    it('should handle Redis errors gracefully', async () => {
      redisService.exists.mockRejectedValue(new Error('Redis error'));

      const result = await service.sessionExists(mockPhoneNumber);

      expect(result).toBe(false);
    });
  });

  describe('getSessionTtl', () => {
    it('should return TTL when session exists', async () => {
      redisService.ttl.mockResolvedValue(3600);

      const result = await service.getSessionTtl(mockPhoneNumber);

      expect(redisService.ttl).toHaveBeenCalledWith('conversation:session:+1234567890');
      expect(result).toBe(3600);
    });

    it('should return -1 when session does not exist', async () => {
      redisService.ttl.mockResolvedValue(-2);

      const result = await service.getSessionTtl(mockPhoneNumber);

      expect(result).toBe(-2);
    });

    it('should handle Redis errors gracefully', async () => {
      redisService.ttl.mockRejectedValue(new Error('Redis error'));

      const result = await service.getSessionTtl(mockPhoneNumber);

      expect(result).toBe(-1);
    });
  });

  describe('extendSession', () => {
    it('should extend session successfully', async () => {
      redisService.ttl.mockResolvedValue(1800); // 30 minutes remaining
      redisService.expire.mockResolvedValue(true);

      const result = await service.extendSession(mockPhoneNumber, 3600);

      expect(redisService.ttl).toHaveBeenCalled();
      expect(redisService.expire).toHaveBeenCalledWith(
        'conversation:session:+1234567890',
        5400 // 1800 + 3600
      );
      expect(result).toBe(true);
    });

    it('should return false when session does not exist', async () => {
      redisService.ttl.mockResolvedValue(-2);

      const result = await service.extendSession(mockPhoneNumber);

      expect(result).toBe(false);
    });

    it('should handle Redis errors gracefully', async () => {
      redisService.ttl.mockRejectedValue(new Error('Redis error'));

      const result = await service.extendSession(mockPhoneNumber);

      expect(result).toBe(false);
    });
  });

  describe('getActiveSessions', () => {
    it('should return list of active phone numbers', async () => {
      const mockKeys = [
        'conversation:session:+1234567890',
        'conversation:session:+0987654321',
      ];
      redisService.keys.mockResolvedValue(mockKeys);

      const result = await service.getActiveSessions();

      expect(redisService.keys).toHaveBeenCalledWith('conversation:session:*');
      expect(result).toEqual(['+1234567890', '+0987654321']);
    });

    it('should return empty array when no sessions found', async () => {
      redisService.keys.mockResolvedValue([]);

      const result = await service.getActiveSessions();

      expect(result).toEqual([]);
    });

    it('should handle Redis errors gracefully', async () => {
      redisService.keys.mockRejectedValue(new Error('Redis error'));

      const result = await service.getActiveSessions();

      expect(result).toEqual([]);
    });
  });

  describe('cleanupExpiredSessions', () => {
    it('should cleanup expired sessions', async () => {
      const mockKeys = [
        'conversation:session:+1234567890',
        'conversation:session:+0987654321',
      ];
      redisService.keys.mockResolvedValue(mockKeys);
      redisService.ttl
        .mockResolvedValueOnce(-2) // First session expired
        .mockResolvedValueOnce(3600); // Second session still active
      redisService.del.mockResolvedValue(true);

      const result = await service.cleanupExpiredSessions();

      expect(redisService.del).toHaveBeenCalledTimes(1);
      expect(result).toBe(1);
    });

    it('should handle Redis errors gracefully', async () => {
      redisService.keys.mockRejectedValue(new Error('Redis error'));

      const result = await service.cleanupExpiredSessions();

      expect(result).toBe(0);
    });
  });

  describe('getSessionStats', () => {
    it('should return session statistics', async () => {
      const mockKeys = [
        'conversation:session:+1234567890',
        'conversation:session:+0987654321',
      ];
      redisService.keys.mockResolvedValue(mockKeys);
      
      const session1 = { ...mockSession, currentState: ConversationState.GREETING };
      const session2 = { ...mockSession, currentState: ConversationState.BROWSING_PRODUCTS };
      
      redisService.get
        .mockResolvedValueOnce(JSON.stringify(session1))
        .mockResolvedValueOnce(JSON.stringify(session2));

      const result = await service.getSessionStats();

      expect(result.totalSessions).toBe(2);
      expect(result.sessionsByState[ConversationState.GREETING]).toBe(1);
      expect(result.sessionsByState[ConversationState.BROWSING_PRODUCTS]).toBe(1);
    });

    it('should handle Redis errors gracefully', async () => {
      redisService.keys.mockRejectedValue(new Error('Redis error'));

      const result = await service.getSessionStats();

      expect(result.totalSessions).toBe(0);
      // The service initializes all states to 0, so we expect the initialized object
      expect(Object.keys(result.sessionsByState)).toEqual(Object.values(ConversationState));
      Object.values(ConversationState).forEach(state => {
        expect(result.sessionsByState[state]).toBe(0);
      });
    });
  });
});