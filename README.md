# WhatsApp Order Bot

A NestJS-based WhatsApp chatbot that handles customer orders, payment processing, and receipt generation.

## Features

- WhatsApp Business API integration
- Order management and processing
- Payment verification and confirmation
- Digital receipt generation
- Product catalog management
- Conversation state management
- Queue-based async processing

## Tech Stack

- **Backend**: NestJS, TypeScript
- **Database**: PostgreSQL with Drizzle ORM
- **Cache/Sessions**: Redis
- **Queue**: Bull Queue
- **Messaging**: WhatsApp Business API
- **Payment**: Configurable payment gateway integration

## Setup

1. Copy environment variables:
   ```bash
   cp .env.example .env
   ```

2. Configure your environment variables in `.env`

3. Install dependencies:
   ```bash
   npm install
   ```

4. Set up database:
   ```bash
   npm run db:generate
   npm run db:migrate
   ```

5. Start the development server:
   ```bash
   npm run start:dev
   ```

## API Endpoints

- `GET /` - Health check
- `GET /health` - Service health status
- `POST /webhook/whatsapp` - WhatsApp webhook endpoint
- `GET /webhook/whatsapp` - WhatsApp webhook verification

## Development

- `npm run start:dev` - Start development server with hot reload
- `npm run test` - Run unit tests
- `npm run test:e2e` - Run end-to-end tests
- `npm run db:studio` - Open Drizzle Studio for database management

## Project Structure

```
src/
├── config/           # Configuration and validation
├── database/         # Database schemas and migrations
├── modules/          # Feature modules
│   ├── whatsapp/     # WhatsApp integration
│   ├── orders/       # Order management
│   ├── products/     # Product catalog
│   ├── payments/     # Payment processing
│   └── conversations/ # Conversation management
├── common/           # Shared utilities and decorators
└── main.ts          # Application entry point
```