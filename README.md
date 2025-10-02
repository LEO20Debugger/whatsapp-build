# WhatsApp Order Bot - Chicken Republic Restaurant

A NestJS-based WhatsApp chatbot for restaurant order processing with conversational commerce capabilities.

## Overview

The application follows a modular architecture with clean separation of concerns:

```
src/
├── modules/
│   ├── conversations/     # Conversation flow and state management
│   ├── whatsapp/         # WhatsApp API integration
│   ├── orders/           # Order management
│   ├── products/         # Product catalog
│   ├── customers/        # Customer management
│   └── payments/         # Payment processing
├── database/             # Database schema and migrations
├── common/              # Shared utilities and types
└── scripts/             # Database seeding and migration scripts
```

## 🤖 Bot Conversation Flow

### States
The bot uses a state machine with the following states:

1. **GREETING** - Initial welcome with Leo introduction + menu display
2. **COLLECTING_NAME** - Collects customer name for new users
3. **MAIN_MENU** - Shows main menu options (currently unused)
4. **BROWSING_PRODUCTS** - Displays product catalog
5. **ADDING_TO_CART** - Handles product selection and cart operations
6. **COLLECTING_QUANTITY** - Asks for product quantity
7. **REVIEWING_ORDER** - Order review and confirmation
8. **AWAITING_PAYMENT** - Payment processing
9. **PAYMENT_CONFIRMATION** - Payment verification
10. **ORDER_COMPLETE** - Order completion

### Current Flow
```
User: "hello" 
Bot: Leo introduction + Full menu display
State: ADDING_TO_CART

User: "1" (selects product)
Bot: Product details + "How many would you like?"
State: COLLECTING_QUANTITY

User: "2" (quantity)
Bot: "Added to cart! Do you want anything else?"
State: ADDING_TO_CART
```

## 📁 Module Documentation

### Conversations Module
**Location**: `src/modules/conversations/`

Core conversation management with state machine implementation.

#### Key Files:
- **`conversation-flow.service.ts`** - Main conversation logic and state handlers
- **`conversation.service.ts`** - High-level conversation orchestration
- **`order-flow.service.ts`** - Cart and order management within conversations
- **`input-parser.service.ts`** - User input parsing and validation
- **`conversation-session.service.ts`** - Redis-based session management

#### Types:
- **`conversation.types.ts`** - Core conversation interfaces and enums
- **`state-machine.types.ts`** - State machine configuration and context keys

### 📱 WhatsApp Module
**Location**: `src/modules/whatsapp/`

WhatsApp Business API integration using Twilio.

#### Key Files:
- **`whatsapp-webhook.controller.ts`** - Webhook endpoint for incoming messages
- **`whatsapp-message.service.ts`** - Outgoing message sending (with dev mode)
- **`message-processing.service.ts`** - Message parsing and routing

#### Features:
- **Development Mode**: Set `WHATSAPP_DEV_MODE=true` to log messages instead of sending
- **Rate Limit Handling**: Automatically switches to dev mode when Twilio limits are hit
- **Message Validation**: Input validation and error handling

### 🛒 Orders Module
**Location**: `src/modules/orders/`

Order management and processing.

#### Key Files:
- **`orders.service.ts`** - Order CRUD operations and business logic
- **`orders.repository.ts`** - Database operations for orders

### 🍽️ Products Module
**Location**: `src/modules/products/`

Product catalog management.

#### Key Files:
- **`products.service.ts`** - Product business logic
- **`products.repository.ts`** - Database operations for products

#### Key Methods:
- `findAvailableProducts()` - Gets all available products
- `searchProducts()` - Product search functionality
- `isProductAvailable()` - Stock availability check

### 👥 Customers Module
**Location**: `src/modules/customers/`

Customer management and recognition.

#### Features:
- **Customer Recognition**: Remembers returning customers by phone number
- **Name Collection**: Collects and stores customer names
- **Personalized Greetings**: Time-based personalized messages

## 🗄️ Database Schema

Using **Drizzle ORM** with **PostgreSQL**.

### Tables:
- **customers** - Customer information and phone numbers
- **products** - Product catalog with pricing and availability
- **orders** - Order records and status
- **order_items** - Individual items within orders
- **payments** - Payment records and verification

### Key Scripts:
- **`scripts/seed-database.ts`** - Seeds sample products
- **`scripts/migrate.ts`** - Runs database migrations

## ⚙️ Configuration

### Environment Variables (.env)
```bash
# Environment
NODE_ENV=development
PORT=4000

# Database (Supabase)
DATABASE_URL=postgresql://postgres:password@db.project.supabase.co:5432/postgres

# Redis
REDIS_HOST=localhost
REDIS_PORT=6379

# WhatsApp (Twilio)
TWILIO_ACCOUNT_SID=your_account_sid
TWILIO_AUTH_TOKEN=your_auth_token
TWILIO_WHATSAPP_NUMBER=whatsapp:+14155238886
WHATSAPP_WEBHOOK_VERIFY_TOKEN=your_verify_token

# Development Mode
WHATSAPP_DEV_MODE=true  # Set to true for development

# Business Settings
BUSINESS_NAME=Chicken Republic Restaurant
TAX_RATE=0.08
PAYMENT_TIMEOUT_MINUTES=30
```

## 🚀 Getting Started

### Prerequisites
- Node.js 18+
- PostgreSQL database (or Supabase)
- Redis server
- Twilio WhatsApp Business account

### Installation
```bash
# Install dependencies
npm install

# Set up environment
cp .env.example .env
# Edit .env with your credentials

# Run database migrations
npm run db:migrate

# Seed sample products
npm run db:seed

# Start development server
npm run start:dev
```

### Development Mode
For development without hitting Twilio rate limits:
```bash
# Enable dev mode in .env
WHATSAPP_DEV_MODE=true

# Messages will be logged to console instead of sent
```

## 🔧 Key Features Implemented

### ✅ Completed Features:
- **Leo Bot Introduction**: Friendly greeting with restaurant branding
- **Product Menu Display**: Categorized product listing with prices
- **Product Selection**: Both number (1,2,3) and name selection
- **Quantity Collection**: Asks for quantity before adding to cart
- **Cart Management**: Add, view, and manage cart items
- **Customer Recognition**: Remembers returning customers
- **Browsing Mode**: "Just browsing" option for window shoppers
- **Development Mode**: Console logging for development
- **Rate Limit Handling**: Graceful handling of Twilio limits
- **Restart Capability**: "hello/hi" restarts conversation anytime

### 🚧 Pending Implementation:
- **Order Review State**: Complete order review functionality
- **Payment Processing**: Payment instruction generation
- **Payment Verification**: Payment confirmation handling
- **Receipt Generation**: Digital receipt creation
- **Order Completion**: Final order completion flow

## 📝 Development Notes

### State Management
- Sessions stored in Redis with phone number as key
- Context preserved across conversation states
- Automatic session cleanup and expiration

### Error Handling
- Graceful fallbacks for service failures
- User-friendly error messages
- Comprehensive logging for debugging

### Testing
- Unit tests for core services
- Integration tests for order flow
- Mock services for external dependencies

### Performance
- Redis caching for session data
- Database connection pooling
- Efficient product queries

## 🔄 Next Steps for Development

### Immediate Tasks:
1. **Complete Order Review State** - Implement `handleReviewingOrderState()`
2. **Payment Flow Integration** - Connect with payment service
3. **Receipt Generation** - Implement digital receipt creation
4. **Error Recovery** - Enhanced error handling and recovery

### Future Enhancements:
1. **Admin Dashboard** - Product and order management
2. **Analytics** - Conversation and sales analytics
3. **Multi-language Support** - Localization capabilities
4. **Advanced Cart Features** - Modify quantities, remove items
5. **Delivery Integration** - Delivery tracking and notifications

## 🐛 Troubleshooting

### Common Issues:
1. **Database Connection**: Check DATABASE_URL and network connectivity
2. **Twilio Rate Limits**: Enable WHATSAPP_DEV_MODE for development
3. **Redis Connection**: Ensure Redis server is running
4. **Product Not Found**: Check if products are seeded in database

### Debug Mode:
```bash
# Enable detailed logging
NODE_ENV=development

# Check application logs for detailed error information
```

## 📚 Additional Resources

- [NestJS Documentation](https://docs.nestjs.com/)
- [Drizzle ORM Guide](https://orm.drizzle.team/)
- [Twilio WhatsApp API](https://www.twilio.com/docs/whatsapp)
- [Redis Documentation](https://redis.io/documentation)

---

**Built with ❤️ for Chicken Republic Restaurant**
