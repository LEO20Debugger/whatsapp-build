import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { RedisService } from './redis.service';

// Mock ioredis
const mockRedisClient = {
  connect: jest.fn(),
  quit: jest.fn(),
  on: jest.fn(),
  ping: jest.fn(),
  set: jest.fn(),
  setex: jest.fn(),
  get: jest.fn(),
  del: jest.fn(),
  exists: jest.fn(),
  expire: jest.fn(),
  ttl: jest.fn(),
  keys: jest.fn(),
  flushdb: jest.fn(),
};

jest.mock('ioredis', () => {
  return jest.fn().mockImplementation(() => mockRedisClient);
});

describe('RedisService', () => {
  let service: RedisService;
  let configService: ConfigService;

  beforeEach(async () => {
    // Reset all mocks
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RedisService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string, defaultValue?: any) => {
              const config = {
                REDIS_HOST: 'localhost',
                REDIS_PORT: 6379,
                REDIS_PASSWORD: '',
              };
              return config[key] || defaultValue;
            }),
          },
        },
      ],
    }).compile();

    service = module.get<RedisService>(RedisService);
    configService = module.get<ConfigService>(ConfigService);
  });

  afterEach(async () => {
    if (service) {
      await service.onModuleDestroy();
    }
  });

  describe('onModuleInit', () => {
    it('should initialize Redis connection successfully', async () => {
      mockRedisClient.connect.mockResolvedValue(undefined);

      await service.onModuleInit();

      expect(require('ioredis')).toHaveBeenCalledWith({
        host: 'localhost',
        port: 6379,
        password: undefined,
        maxRetriesPerRequest: 3,
        lazyConnect: true,
        enableReadyCheck: true,
        connectTimeout: 10000,
        commandTimeout: 5000,
      });
      expect(mockRedisClient.connect).toHaveBeenCalled();
      expect(service.isRedisAvailable()).toBe(true);
    });

    it('should handle missing Redis configuration', async () => {
      jest.spyOn(configService, 'get').mockReturnValue(undefined);

      await service.onModuleInit();

      expect(require('ioredis')).not.toHaveBeenCalled();
      expect(service.isRedisAvailable()).toBe(false);
    });

    it('should handle connection failure', async () => {
      mockRedisClient.connect.mockRejectedValue(new Error('Connection failed'));

      await service.onModuleInit();

      expect(service.isRedisAvailable()).toBe(false);
    });
  });

  describe('Redis operations', () => {
    beforeEach(async () => {
      mockRedisClient.connect.mockResolvedValue(undefined);
      await service.onModuleInit();
    });

    describe('set', () => {
      it('should set value without TTL', async () => {
        mockRedisClient.set.mockResolvedValue('OK');

        const result = await service.set('test-key', 'test-value');

        expect(mockRedisClient.set).toHaveBeenCalledWith('test-key', 'test-value');
        expect(result).toBe(true);
      });

      it('should set value with TTL', async () => {
        mockRedisClient.setex.mockResolvedValue('OK');

        const result = await service.set('test-key', 'test-value', 300);

        expect(mockRedisClient.setex).toHaveBeenCalledWith('test-key', 300, 'test-value');
        expect(result).toBe(true);
      });

      it('should handle set operation failure', async () => {
        mockRedisClient.set.mockRejectedValue(new Error('Set failed'));

        const result = await service.set('test-key', 'test-value');

        expect(result).toBe(false);
      });

      it('should return false when Redis is not available', async () => {
        // Simulate Redis not available
        service['isAvailable'] = false;

        const result = await service.set('test-key', 'test-value');

        expect(result).toBe(false);
        expect(mockRedisClient.set).not.toHaveBeenCalled();
      });
    });

    describe('get', () => {
      it('should get value successfully', async () => {
        mockRedisClient.get.mockResolvedValue('test-value');

        const result = await service.get('test-key');

        expect(mockRedisClient.get).toHaveBeenCalledWith('test-key');
        expect(result).toBe('test-value');
      });

      it('should return null for non-existent key', async () => {
        mockRedisClient.get.mockResolvedValue(null);

        const result = await service.get('non-existent-key');

        expect(result).toBeNull();
      });

      it('should handle get operation failure', async () => {
        mockRedisClient.get.mockRejectedValue(new Error('Get failed'));

        const result = await service.get('test-key');

        expect(result).toBeNull();
      });
    });

    describe('del', () => {
      it('should delete key successfully', async () => {
        mockRedisClient.del.mockResolvedValue(1);

        const result = await service.del('test-key');

        expect(mockRedisClient.del).toHaveBeenCalledWith('test-key');
        expect(result).toBe(true);
      });

      it('should return false when key does not exist', async () => {
        mockRedisClient.del.mockResolvedValue(0);

        const result = await service.del('non-existent-key');

        expect(result).toBe(false);
      });

      it('should handle delete operation failure', async () => {
        mockRedisClient.del.mockRejectedValue(new Error('Delete failed'));

        const result = await service.del('test-key');

        expect(result).toBe(false);
      });
    });

    describe('exists', () => {
      it('should return true when key exists', async () => {
        mockRedisClient.exists.mockResolvedValue(1);

        const result = await service.exists('test-key');

        expect(mockRedisClient.exists).toHaveBeenCalledWith('test-key');
        expect(result).toBe(true);
      });

      it('should return false when key does not exist', async () => {
        mockRedisClient.exists.mockResolvedValue(0);

        const result = await service.exists('non-existent-key');

        expect(result).toBe(false);
      });
    });

    describe('expire', () => {
      it('should set expiration successfully', async () => {
        mockRedisClient.expire.mockResolvedValue(1);

        const result = await service.expire('test-key', 300);

        expect(mockRedisClient.expire).toHaveBeenCalledWith('test-key', 300);
        expect(result).toBe(true);
      });

      it('should return false when key does not exist', async () => {
        mockRedisClient.expire.mockResolvedValue(0);

        const result = await service.expire('non-existent-key', 300);

        expect(result).toBe(false);
      });
    });

    describe('ttl', () => {
      it('should return TTL for key', async () => {
        mockRedisClient.ttl.mockResolvedValue(300);

        const result = await service.ttl('test-key');

        expect(mockRedisClient.ttl).toHaveBeenCalledWith('test-key');
        expect(result).toBe(300);
      });

      it('should return -1 for key without expiration', async () => {
        mockRedisClient.ttl.mockResolvedValue(-1);

        const result = await service.ttl('test-key');

        expect(result).toBe(-1);
      });
    });

    describe('keys', () => {
      it('should return matching keys', async () => {
        const mockKeys = ['session:user1', 'session:user2'];
        mockRedisClient.keys.mockResolvedValue(mockKeys);

        const result = await service.keys('session:*');

        expect(mockRedisClient.keys).toHaveBeenCalledWith('session:*');
        expect(result).toEqual(mockKeys);
      });

      it('should return empty array when no keys match', async () => {
        mockRedisClient.keys.mockResolvedValue([]);

        const result = await service.keys('nonexistent:*');

        expect(result).toEqual([]);
      });
    });

    describe('flushdb', () => {
      it('should flush database successfully', async () => {
        mockRedisClient.flushdb.mockResolvedValue('OK');

        const result = await service.flushdb();

        expect(mockRedisClient.flushdb).toHaveBeenCalled();
        expect(result).toBe(true);
      });

      it('should handle flush operation failure', async () => {
        mockRedisClient.flushdb.mockRejectedValue(new Error('Flush failed'));

        const result = await service.flushdb();

        expect(result).toBe(false);
      });
    });
  });

  describe('healthCheck', () => {
    it('should return healthy status when Redis is available', async () => {
      mockRedisClient.connect.mockResolvedValue(undefined);
      mockRedisClient.ping.mockResolvedValue('PONG');
      await service.onModuleInit();

      const result = await service.healthCheck();

      expect(result.isHealthy).toBe(true);
      expect(result.details).toMatchObject({
        configured: true,
        available: true,
        reconnectAttempts: 0,
      });
      expect(result.details.responseTime).toBeGreaterThanOrEqual(0);
    });

    it('should return unhealthy status when Redis is not configured', async () => {
      service['client'] = null;

      const result = await service.healthCheck();

      expect(result.isHealthy).toBe(false);
      expect(result.error).toBe('Redis not configured');
      expect(result.details).toMatchObject({
        configured: false,
      });
    });

    it('should return unhealthy status when Redis is not available', async () => {
      mockRedisClient.connect.mockResolvedValue(undefined);
      await service.onModuleInit();
      service['isAvailable'] = false;

      const result = await service.healthCheck();

      expect(result.isHealthy).toBe(false);
      expect(result.error).toBe('Redis not available');
      expect(result.details).toMatchObject({
        configured: true,
        available: false,
      });
    });

    it('should return unhealthy status when ping fails', async () => {
      mockRedisClient.connect.mockResolvedValue(undefined);
      mockRedisClient.ping.mockRejectedValue(new Error('Ping failed'));
      await service.onModuleInit();

      const result = await service.healthCheck();

      expect(result.isHealthy).toBe(false);
      expect(result.error).toBe('Ping failed');
    });

    it('should return unhealthy status when ping returns unexpected response', async () => {
      mockRedisClient.connect.mockResolvedValue(undefined);
      mockRedisClient.ping.mockResolvedValue('UNEXPECTED');
      await service.onModuleInit();

      const result = await service.healthCheck();

      expect(result.isHealthy).toBe(false);
      expect(result.error).toBe('Unexpected ping response: UNEXPECTED');
    });
  });

  describe('retry logic', () => {
    beforeEach(async () => {
      mockRedisClient.connect.mockResolvedValue(undefined);
      await service.onModuleInit();
    });

    it('should retry failed operations', async () => {
      mockRedisClient.get
        .mockRejectedValueOnce(new Error('First attempt failed'))
        .mockRejectedValueOnce(new Error('Second attempt failed'))
        .mockResolvedValueOnce('success');

      const result = await service.get('test-key');

      expect(mockRedisClient.get).toHaveBeenCalledTimes(3);
      expect(result).toBe('success');
    });

    it('should give up after max retries', async () => {
      mockRedisClient.get.mockRejectedValue(new Error('Always fails'));

      const result = await service.get('test-key');

      expect(mockRedisClient.get).toHaveBeenCalledTimes(3);
      expect(result).toBeNull();
    });
  });

  describe('onModuleDestroy', () => {
    it('should close Redis connection gracefully', async () => {
      mockRedisClient.connect.mockResolvedValue(undefined);
      mockRedisClient.quit.mockResolvedValue('OK');
      await service.onModuleInit();

      await service.onModuleDestroy();

      expect(mockRedisClient.quit).toHaveBeenCalled();
      expect(service.isRedisAvailable()).toBe(false);
    });

    it('should handle case when client is null', async () => {
      service['client'] = null;

      await expect(service.onModuleDestroy()).resolves.not.toThrow();
    });
  });
});