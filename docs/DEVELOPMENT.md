# Development Guide

## 🚀 Quick Start

### Prerequisites
```bash
# Required software
- Node.js 18+ 
- PostgreSQL 13+ (or Supabase account)
- Redis 6+ 
- Git

# Optional for local development
- Docker & Docker Compose
- Twilio WhatsApp Business account
```

### Setup Steps
```bash
# 1. Clone and install
git clone <repository-url>
cd whatsapp-order-bot
npm install

# 2. Environment setup
cp .env.example .env
# Edit .env with your credentials

# 3. Database setup
npm run db:migrate
npm run db:seed

# 4. Start development
npm run start:dev
```

## 🔧 Development Workflow

### Daily Development
```bash
# Start development server with hot reload
npm run start:dev

# Run tests
npm test
npm run test:watch

# Build for production
npm run build

# Database operations
npm run db:migrate    # Run migrations
npm run db:seed      # Seed sample data
npm run db:studio    # Open Drizzle Studio
```

### Code Quality
```bash
# Linting and formatting
npm run lint         # ESLint check
npm run lint:fix     # Auto-fix linting issues
npm run format       # Prettier formatting

# Type checking
npm run build        # TypeScript compilation check
```

## 📁 Project Structure

```
src/
├── modules/
│   ├── conversations/           # 🗣️ Core conversation logic
│   │   ├── services/
│   │   │   ├── conversation-flow.service.ts      # Main state machine
│   │   │   ├── conversation.service.ts           # High-level orchestration
│   │   │   ├── order-flow.service.ts            # Cart management
│   │   │   ├── input-parser.service.ts          # Input validation
│   │   │   └── conversation-session.service.ts  # Redis sessions
│   │   ├── types/
│   │   │   ├── conversation.types.ts            # Core interfaces
│   │   │   └── state-machine.types.ts           # State machine types
│   │   └── conversations.module.ts
│   │
│   ├── whatsapp/                # 📱 WhatsApp integration
│   │   ├── controllers/
│   │   │   └── whatsapp-webhook.controller.ts   # Webhook endpoint
│   │   ├── services/
│   │   │   ├── whatsapp-message.service.ts      # Send messages
│   │   │   └── message-processing.service.ts    # Process incoming
│   │   ├── interfaces/          # TypeScript interfaces
│   │   └── whatsapp.module.ts
│   │
│   ├── orders/                  # 🛒 Order management
│   │   ├── orders.service.ts
│   │   ├── orders.repository.ts
│   │   └── orders.module.ts
│   │
│   ├── products/                # 🍽️ Product catalog
│   │   ├── products.service.ts
│   │   ├── products.repository.ts
│   │   └── products.module.ts
│   │
│   ├── customers/               # 👥 Customer management
│   │   ├── customers.repository.ts
│   │   └── customers.module.ts
│   │
│   └── payments/                # 💳 Payment processing
│       ├── payments.repository.ts
│       └── payments.module.ts
│
├── database/                    # 🗄️ Database layer
│   ├── schema/                  # Drizzle schema definitions
│   ├── migrations/              # Database migrations
│   ├── database.service.ts      # Connection management
│   └── types.ts                 # Database types
│
├── common/                      # 🔧 Shared utilities
│   ├── queue/                   # Bull queue processors
│   └── utils/                   # Helper functions
│
└── scripts/                     # 📜 Utility scripts
    ├── seed-database.ts         # Sample data seeding
    └── migrate.ts               # Migration runner
```

## 🎯 Key Development Areas

### 1. Adding New Conversation States

```typescript
// 1. Add to enum in conversation.types.ts
export enum ConversationState {
  // ... existing states
  NEW_STATE = "new_state",
}

// 2. Add handler in conversation-flow.service.ts
private async handleNewState(
  session: ConversationSession,
  parsedInput: ParsedInput,
): Promise<BotResponse> {
  // Implementation here
  return {
    message: "Response message",
    nextState: ConversationState.NEXT_STATE,
  };
}

// 3. Register in state handlers map
const stateHandlers = {
  // ... existing handlers
  [ConversationState.NEW_STATE]: this.handleNewState.bind(this),
};
```

### 2. Adding New Products

```typescript
// Option 1: Via database seeding (scripts/seed-database.ts)
const newProducts = [
  {
    name: 'New Product',
    description: 'Product description',
    price: '1500.00',
    category: 'Category',
    stockQuantity: 50,
    sku: 'PROD-001',
    available: true,
  }
];

// Option 2: Via API (future admin interface)
await productsService.createProduct(productData);
```

### 3. Customizing Bot Responses

```typescript
// In conversation-flow.service.ts
private getGreetingMessage(): string {
  return `Hi there! 👋 My name is Leo.. Welcome to ${BUSINESS_NAME}! 🍗\n\nI'm here to help you order some delicious food today!`;
}

// Personalized messages
private getPersonalizedMessage(customerName: string, message: string): string {
  return customerName ? `${message}, ${customerName}` : message;
}
```

### 4. Adding Payment Integration

```typescript
// In payments module
@Injectable()
export class PaymentService {
  async generatePaymentInstructions(order: Order): Promise<PaymentInstructions> {
    // Implementation for your payment gateway
  }
  
  async verifyPayment(reference: string): Promise<PaymentVerification> {
    // Payment verification logic
  }
}
```

## 🧪 Testing Guidelines

### Unit Testing
```typescript
// Example test structure
describe('ConversationFlowService', () => {
  let service: ConversationFlowService;
  let mockProductsRepository: jest.Mocked<ProductsRepository>;
  
  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        ConversationFlowService,
        {
          provide: ProductsRepository,
          useValue: createMockRepository(),
        },
      ],
    }).compile();
    
    service = module.get<ConversationFlowService>(ConversationFlowService);
    mockProductsRepository = module.get(ProductsRepository);
  });
  
  it('should handle product selection correctly', async () => {
    // Test implementation
  });
});
```

### Integration Testing
```typescript
// Test complete conversation flows
describe('Order Flow Integration', () => {
  it('should complete full order process', async () => {
    // 1. Start conversation
    // 2. Select product
    // 3. Add to cart
    // 4. Proceed to checkout
    // 5. Verify order creation
  });
});
```

### Testing with Development Mode
```bash
# Enable dev mode to test without sending WhatsApp messages
WHATSAPP_DEV_MODE=true npm run start:dev

# Messages will be logged to console:
# 🚀 DEV MODE - Would send message to +1234567890:
# 📱 Message: Hello! Welcome to our restaurant!
```

## 🔍 Debugging

### Common Debug Scenarios

#### 1. Message Not Processing
```typescript
// Check logs for:
[WhatsAppWebhookController] Received WhatsApp webhook payload
[MessageProcessingService] Processing message ... from ...
[ConversationFlowService] Current state: ADDING_TO_CART

// Common issues:
- Webhook URL not configured in Twilio
- Invalid webhook verification token
- Database connection issues
```

#### 2. Products Not Loading
```typescript
// Check:
- Database connection: npm run db:studio
- Products seeded: SELECT * FROM products;
- Repository method: findAvailableProducts()

// Debug logs:
[ConversationFlowService] Error fetching products: ...
```

#### 3. Session Issues
```typescript
// Check Redis connection:
redis-cli ping

// Check session data:
redis-cli keys "*"
redis-cli get "session:+1234567890"
```

### Debug Tools
```bash
# Database inspection
npm run db:studio              # Visual database browser

# Redis inspection  
redis-cli                      # Redis command line
redis-cli monitor             # Watch Redis operations

# Application logs
npm run start:dev             # Development with detailed logs
DEBUG=* npm run start:dev     # Maximum verbosity
```

## 🚀 Deployment

### Environment Setup
```bash
# Production environment variables
NODE_ENV=production
WHATSAPP_DEV_MODE=false
DATABASE_URL=postgresql://user:pass@prod-db:5432/db
REDIS_HOST=prod-redis-host
```

### Build and Deploy
```bash
# Build for production
npm run build

# Start production server
npm run start:prod

# Or with PM2
pm2 start dist/main.js --name whatsapp-bot
```

### Health Checks
```bash
# Application health
curl http://localhost:4000/health

# Database health
curl http://localhost:4000/health/database

# Redis health  
curl http://localhost:4000/health/redis
```

## 📊 Monitoring

### Key Metrics to Monitor
- Response time per conversation state
- Database query performance
- Redis hit/miss ratios
- WhatsApp API rate limit usage
- Error rates by module
- Active conversation sessions

### Logging Best Practices
```typescript
// Structured logging
this.logger.log('Message processed successfully', {
  phoneNumber: session.phoneNumber,
  messageId: message.id,
  currentState: session.currentState,
  processingTime: Date.now() - startTime,
});

// Error logging with context
this.logger.error('Failed to process message', {
  phoneNumber: session.phoneNumber,
  error: error.message,
  stack: error.stack,
  messageContent: message.text?.body,
});
```

## 🔧 Troubleshooting

### Common Issues

#### Twilio Rate Limits
```bash
# Error: Account exceeded the 9 daily messages limit
# Solution: Enable development mode
WHATSAPP_DEV_MODE=true
```

#### Database Connection
```bash
# Error: Database connection failed
# Check: DATABASE_URL format and credentials
# Test: npm run db:studio
```

#### Redis Connection
```bash
# Error: Redis connection refused
# Check: Redis server running on correct port
# Test: redis-cli ping
```

#### Build Errors
```bash
# TypeScript compilation errors
npm run build

# Common fixes:
- Update type definitions
- Check import paths
- Verify interface implementations
```

## 📚 Resources

### Documentation
- [NestJS Docs](https://docs.nestjs.com/)
- [Drizzle ORM](https://orm.drizzle.team/)
- [Twilio WhatsApp API](https://www.twilio.com/docs/whatsapp)

### Tools
- [Drizzle Studio](https://orm.drizzle.team/drizzle-studio/overview) - Database GUI
- [Redis Commander](https://github.com/joeferner/redis-commander) - Redis GUI
- [Postman](https://www.postman.com/) - API testing

---

Happy coding! 🚀