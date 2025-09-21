import { Test, TestingModule } from "@nestjs/testing";
import { ConfigModule } from "@nestjs/config";
import { sql } from "drizzle-orm";
import { DatabaseService } from "./database.service";

describe("DatabaseService", () => {
  let service: DatabaseService;
  let module: TestingModule;

  beforeAll(async () => {
    module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          envFilePath: [".env.test", ".env"],
        }),
      ],
      providers: [DatabaseService],
    }).compile();

    service = module.get<DatabaseService>(DatabaseService);
  });

  afterAll(async () => {
    await module.close();
  });

  describe("connection", () => {
    it("should be defined", () => {
      expect(service).toBeDefined();
    });

    it("should connect to database", async () => {
      const isHealthy = service.isHealthy();
      expect(isHealthy).toBe(true);
    });

    it("should perform health check", async () => {
      const health = await service.healthCheck();
      expect(health.isHealthy).toBe(true);
      expect(health.lastChecked).toBeInstanceOf(Date);
    });

    it("should get connection info", async () => {
      const info = await service.getConnectionInfo();
      expect(info.totalConnections).toBeGreaterThanOrEqual(0);
      expect(info.activeConnections).toBeGreaterThanOrEqual(0);
      expect(info.idleConnections).toBeGreaterThanOrEqual(0);
    });
  });

  describe("transactions", () => {
    it("should execute transaction successfully", async () => {
      const result = await service.transaction(async (tx) => {
        const testResult = await tx.execute(sql`SELECT 1 as test`);
        return testResult;
      });

      expect(result).toBeDefined();
    });

    it("should rollback transaction on error", async () => {
      await expect(
        service.transaction(async (tx) => {
          await tx.execute(sql`SELECT 1 as test`);
          throw new Error("Test error");
        }),
      ).rejects.toThrow("Test error");
    });
  });

  describe("raw queries", () => {
    it("should execute raw query", async () => {
      const result = await service.executeRaw("SELECT 1 as test");
      expect(result).toHaveLength(1);
      expect(result[0].test).toBe(1);
    });

    it("should execute parameterized query", async () => {
      const result = await service.executeRaw("SELECT $1 as value", ["test"]);
      expect(result).toHaveLength(1);
      expect(result[0].value).toBe("test");
    });
  });
});
