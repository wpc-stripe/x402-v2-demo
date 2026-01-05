# x402 Payment-Protected API Demo

This project demonstrates how to implement a payment-protected API endpoint using the x402 payment protocol with Stripe crypto payments and Coinbase's Base facilitator.

## Features

- **Payment-Protected Endpoint**: GET `/api/data` requires a $0.01 USDC payment
- **Stripe Integration**: Dynamic PaymentIntent creation for crypto deposit addresses
- **Caching**: Ensures payment retries use the same deposit address
- **Base Network**: Payments settled on Base (eip155:8453) using USDC
- **CDP Facilitator**: Coinbase Developer Platform handles payment verification and settlement
- **EIP-3712**: Secure, gasless transfer authorization signatures

## Prerequisites

- Node.js 16+
- Stripe account with crypto payments enabled
- Coinbase Developer Platform API credentials
- Environment variables configured (see below)

## Setup

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Configure environment variables:**
   Create a `.env` file with the following:
   ```env
   FACILITATOR_URL=https://api.cdp.coinbase.com/platform/v2/x402
   STRIPE_SECRET_KEY=sk_live_...
   CDP_KEY=your-cdp-api-key-id
   CDP_API_KEY_SECRET=your-cdp-api-key-secret
   ```

3. **Start the server:**
   ```bash
   npm start
   ```

The server will run on `http://localhost:3000`.

## How It Works

### Payment Flow

1. **Initial Request**: Client requests `GET /api/data` without payment
   - Server responds with `402 Payment Required`
   - Response includes payment requirements (amount, network, deposit address)
   - A Stripe PaymentIntent is created with a unique deposit address
   - Address is cached for 5 minutes

2. **Payment Signature**: Client creates EIP-3712 transfer authorization
   - Signs authorization to transfer USDC to the deposit address
   - Sends signed authorization in `payment-signature` header

3. **Verification**: Server verifies payment with CDP facilitator
   - Checks cache to ensure same deposit address is used
   - Facilitator validates the transfer authorization signature

4. **Settlement**: Facilitator submits transaction on-chain
   - Transfer is executed on Base network
   - Transaction hash returned in response

5. **Access Granted**: Protected content served to client

### Key Components

- **Dynamic PayTo**: Creates new Stripe deposit addresses per payment request
- **Address Caching**: Ensures payment retries reference the same address
- **CDP Authentication**: JWT-based authentication for facilitator endpoints
- **Lifecycle Hooks**: Logging for verification and settlement events

## API Endpoints

### GET /api/data

Protected endpoint requiring payment.

**Without Payment:**
```bash
curl http://localhost:3000/api/data
# Returns 402 Payment Required with payment requirements
```

**With Payment:**
```bash
curl -H "payment-signature: <base64-encoded-signature>" \
  http://localhost:3000/api/data
# Returns protected data
```

## Testing

For automated testing with a wallet client, see `client.ts`.

## Project Structure

```
├── server.ts          # Main Express server with x402 middleware
├── client.ts          # Example client implementation
├── .env               # Environment variables (create this)
├── package.json       # Dependencies and scripts
└── README.md          # This file
```

## Dependencies

- `@x402/express` - x402 Express middleware
- `@x402/evm` - EVM payment scheme
- `@x402/paywall` - Browser payment UI integration
- `stripe` - Stripe API client
- `@coinbase/cdp-sdk` - Coinbase Developer Platform SDK
- `node-cache` - In-memory caching

## Architecture

```
┌─────────┐         ┌─────────┐         ┌──────────┐         ┌─────────┐
│ Client  │────1───▶│  Server │────2───▶│  Stripe  │         │   CDP   │
│         │◀───────▶│  (x402) │         │          │         │Facilit- │
└─────────┘         └─────────┘         └──────────┘         │ ator    │
     │                    │                                   └─────────┘
     └────────────3──────▶│                                        │
                          │──────────4─────────────────────────────┤
                          │◀──────────────────────────────────────▶│
                          │                                        │
                          └────────5─────────────────────────────▶ │
                                                                   ▼
                                                              Base Network
```

1. Client requests endpoint, receives payment requirements with Stripe address
2. Server creates Stripe PaymentIntent and caches deposit address
3. Client signs EIP-3712 transfer authorization and retries with signature
4. Server verifies signature with CDP facilitator (checks cache for address)
5. Facilitator settles payment on-chain

## License

MIT
