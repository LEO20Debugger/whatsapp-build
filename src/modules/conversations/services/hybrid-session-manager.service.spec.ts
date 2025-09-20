import { Test, TestingModule } from '@nestjs/testing';
import { HybridSessionManager } from './hybrid-session-manager.service';
import { RedisService } from '../../../common/redis/redis.service';
import { ConversationSessionRepository } from '../repositories/conversation-session.repository';
import { ConversationState } from '../types/conversation.types';

describe('HybridSessionManager', () => {
  let service: HybridSessionManager;
  let redisService: jest.Mocked<RedisService>;
  let sessionRepository: jest.Mocked<ConversationSessionRepository>;

  const mockPhoneNumber = '+1234567890';

  beforeEach(async () => {
    const mockRedisService = {
      isRedisAvailable: jest.fn(),
      get: jest.fn(),
      set: jest.fn(),
      del: jest.fn(),
      keys: jest.fn(),
    };

    const mockSessionRepository = {
      create: jest.fn(),
      findByPhoneNumber: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      findActiveSessions: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HybridSessionManager,
        {
          provide: RedisService,
          useValue: mockRedisService,
        },
        {
          provide: ConversationSessionRepository,
          useValue: mockSessionRepository,
        },
      ],
    }).compile();

    service = module.get<HybridSessionManager>(HybridSessionManager);
    redisService = module.get(RedisService);
    sessionRepository = module.get(ConversationSessionRepository);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getSession', () => {
    it('should return session from Redis when available', async () => {
      const mockSession = {
        phoneNumber: mockPhoneNumber,
        currentState: ConversationState.GREETING,
        lastActivity: new Date(),
        context: {},
      };

      redisService.isRedisAvailable.mockReturnValue(true);
      redisService.get.mockResolvedValue(JSON.stringify(mockSession));

      const result = await service.getSession(mockPhoneNumber);

      expect(result).toEqual(expect.objectContaining({
        phoneNumber: mockPhoneNumber,
        currentState: ConversationState.GREETING,
      }));
      expect(redisService.get).toHaveBeenCalled();
      expect(sessionRepository.findByPhoneNumber).not.toHaveBeenCalled();
    });

    it('should fallback to database when Redis is unavailable', async () => {
      const mockDbSession = {
        id: 'test-id',
        phoneNumber: mockPhoneNumber,
        currentState: 'greeting',
        lastActivity: new Date(),
        context: {},
        customerId: 'customer-id',
        createdAt: new Date(),
        updatedAt: new Date(),
        expiresAt: new Date(),
      };

      redisService.isRedisAvailable.mockReturnValue(false);
      sessionRepository.findByPhoneNumber.mockResolvedValue(mockDbSession as any);
      redisService.set.mockResolvedValue(true);

      const result = await service.getSession(mockPhoneNumber);

      expect(result).toEqual(expect.objectContaining({
        phoneNumber: mockPhoneNumber,
        currentState: ConversationState.GREETING,
      }));
      expect(sessionRepository.findByPhoneNumber).toHaveBeenCalledWith(mockPhoneNumber);
    });

    it('should return null when session not found', async () => {
      redisService.isRedisAvailable.mockReturnValue(true);
      redisService.get.mockResolvedValue(null);
      sessionRepository.findByPhoneNumber.mockResolvedValue(null);

      const result = await service.getSession(mockPhoneNumber);

      expect(result).toBeNull();
    });
  });

  describe('createSession', () => {
    it('should create session in both Redis and database', async () => {
      const mockDbSession = {
        id: 'test-id',
        phoneNumber: mockPhoneNumber,
        currentState: 'greeting',
        lastActivity: new Date(),
        context: {},
        customerId: 'customer-id',
        createdAt: new Date(),
        updatedAt: new Date(),
        expiresAt: new Date(),
      };

      sessionRepository.create.mockResolvedValue(mockDbSession as any);
      redisService.isRedisAvailable.mockReturnValue(true);
      redisService.set.mockResolvedValue(true);

      const result = await service.createSession(mockPhoneNumber);

      expect(result).toEqual(expect.objectContaining({
        phoneNumber: mockPhoneNumber,
        currentState: ConversationState.GREETING,
      }));
      expect(sessionRepository.create).toHaveBeenCalled();
      expect(redisService.set).toHaveBeenCalled();
    });
  });

  describe('updateSession', () => {
    it('should update session in both Redis and database', async () => {
      const mockSession = {
        phoneNumber: mockPhoneNumber,
        currentState: ConversationState.BROWSING_PRODUCTS,
        lastActivity: new Date(),
        context: { test: 'value' },
      };

      const mockDbSession = {
        id: 'test-id',
        phoneNumber: mockPhoneNumber,
        currentState: 'greeting',
        lastActivity: new Date(),
        context: {},
        customerId: 'customer-id',
        createdAt: new Date(),
        updatedAt: new Date(),
        expiresAt: new Date(),
      };

      sessionRepository.findByPhoneNumber.mockResolvedValue(mockDbSession as any);
      sessionRepository.update.mockResolvedValue(mockDbSession as any);
      redisService.isRedisAvailable.mockReturnValue(true);
      redisService.set.mockResolvedValue(true);

      const result = await service.updateSession(mockSession);

      expect(result).toBe(true);
      expect(sessionRepository.update).toHaveBeenCalled();
      expect(redisService.set).toHaveBeenCalled();
    });
  });

  describe('deleteSession', () => {
    it('should delete session from both Redis and database', async () => {
      const mockDbSession = {
        id: 'test-id',
        phoneNumber: mockPhoneNumber,
        currentState: 'greeting',
        lastActivity: new Date(),
        context: {},
        customerId: 'customer-id',
        createdAt: new Date(),
        updatedAt: new Date(),
        expiresAt: new Date(),
      };

      redisService.del.mockResolvedValue(true);
      sessionRepository.findByPhoneNumber.mockResolvedValue(mockDbSession as any);
      sessionRepository.delete.mockResolvedValue(true);

      const result = await service.deleteSession(mockPhoneNumber);

      expect(result).toBe(true);
      expect(redisService.del).toHaveBeenCalled();
      expect(sessionRepository.delete).toHaveBeenCalledWith('test-id');
    });
  });

  describe('getActiveSessionsCount', () => {
    it('should return count from Redis when available', async () => {
      redisService.isRedisAvailable.mockReturnValue(true);
      redisService.keys.mockResolvedValue(['session:1', 'session:2', 'session:3']);

      const result = await service.getActiveSessionsCount();

      expect(result).toBe(3);
      expect(redisService.keys).toHaveBeenCalled();
      expect(sessionRepository.findActiveSessions).not.toHaveBeenCalled();
    });

    it('should fallback to database when Redis is unavailable', async () => {
      redisService.isRedisAvailable.mockReturnValue(false);
      sessionRepository.findActiveSessions.mockResolvedValue([{}, {}, {}] as any);

      const result = await service.getActiveSessionsCount();

      expect(result).toBe(3);
      expect(sessionRepository.findActiveSessions).toHaveBeenCalled();
    });
  });
});