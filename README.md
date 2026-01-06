# x402 Payment-Protected API Demo

This project demonstrates how to implement a payment-protected API endpoint using the x402 payment protocol with Stripe crypto payments and Coinbase's Base facilitator.

## Features

- **Payment-Protected Endpoint**: GET `/api/data` requires a $0.01 USDC payment on Base mainnet
- **Stripe Crypto Integration**: Dynamic PaymentIntent creation for unique crypto deposit addresses
- **Smart Caching**: 5-minute address cache ensures payment retries use the same deposit address
- **Address Normalization**: Lowercase address handling prevents case-sensitivity issues
- **Base Network**: Payments settled on Base mainnet (eip155:8453) using USDC (0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913)
- **CDP Facilitator**: Coinbase Developer Platform handles on-chain payment verification and settlement
- **EIP-3712 Transfer Authorization**: Secure, gasless payment signatures
- **Browser Paywall UI**: Optional @x402/paywall integration for wallet connection UI

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Copy environment template
cp .env.example .env

# 3. Add your credentials to .env
# - STRIPE_SECRET_KEY from https://dashboard.stripe.com/apikeys
# - CDP_KEY and CDP_API_KEY_SECRET from https://portal.cdp.coinbase.com/

# 4. Start the server
npm start

# 5. Test in another terminal
curl http://localhost:3000/api/data
```

## Prerequisites

- **Node.js 16+** with npm
- **Stripe Account** with [crypto payments enabled](https://stripe.com/docs/crypto)
- **Coinbase Developer Platform** account with API credentials
- **Base Mainnet** for production (or Base Sepolia for testing)

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

- **Dynamic PayTo Function**:
  - Checks if payment signature contains a previously cached address
  - If cached, reuses the same Stripe deposit address (critical for payment retries)
  - If not cached, creates a new Stripe PaymentIntent with a fresh deposit address
  - Normalizes all addresses to lowercase before caching/comparison

- **Address Caching Strategy**:
  - Uses `node-cache` with 5-minute TTL (300 seconds)
  - Keys: normalized lowercase deposit addresses
  - Values: PaymentIntent ID and amount in cents
  - Cache lookup occurs when payment signature is present

- **CDP JWT Authentication**:
  - Generates separate JWT tokens for each facilitator endpoint:
    - `/verify` - POST request to validate payment signatures
    - `/settle` - POST request to execute on-chain transfers
    - `/supported` - GET request to query supported networks
  - Tokens expire in 120 seconds and are regenerated per request

- **Lifecycle Hooks**:
  - `onAfterVerify`: Logs successful verification with payer address
  - `onVerifyFailure`: Logs verification errors
  - `onAfterSettle`: Logs transaction hash after on-chain settlement
  - `onSettleFailure`: Logs settlement errors

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

### Manual Testing

1. **Start the server** (in one terminal):
   ```bash
   npm start
   ```

   Expected output:
   ```
   Server is running on http://localhost:3000
   (node:xxxxx) ExperimentalWarning: The Ed25519 Web Crypto API algorithm is an experimental feature...
   ```

   > **Note**: The terminal will appear to "hang" - this is normal! The server is running and waiting for requests. Don't close this terminal.

2. **Make a request** (in a new terminal):
   ```bash
   curl http://localhost:3000/api/data
   ```

   Expected response (402 Payment Required with payment requirements):
   ```json
   {
     "error": "Payment Required",
     "payment": {
       "scheme": "exact",
       "amount": "10000",
       "network": "eip155:8453",
       "payTo": "0x...",
       ...
     }
   }
   ```

3. **Check server logs** for PaymentIntent creation:
   ```
   💳 Created PaymentIntent pi_3xxx... for $0.01 → 0x...
   ```

### Automated Testing

For automated testing with a wallet client, you can use the `@x402/fetch` library to handle the full payment flow:

```typescript
// Usage: ./node_modules/.bin/tsx client.ts
// https://github.com/coinbase/x402/blob/main/docs/guides/migration-v1-to-v2.md
import { wrapFetchWithPayment, x402Client } from "@x402/fetch";
import { registerExactEvmScheme } from "@x402/evm/exact/client";
import { privateKeyToAccount } from "viem/accounts";
import { webcrypto } from "crypto";

globalThis.crypto = webcrypto as any;

if (!process.env.EVM_PRIVATE_KEY) {
  console.error("You must pass an EVM_PRIVATE_KEY to sign x402 requests")
}

const account = privateKeyToAccount(
  process.env.EVM_PRIVATE_KEY
);

const client = new x402Client();
registerExactEvmScheme(client, { signer: account });

const fetchWithPay = wrapFetchWithPayment(fetch, client);

async function main() {
  const response = await fetchWithPay("http://localhost:3000/api/data", {
    method: "GET",
  });
  if (!response.ok) {
    throw new Error(
      `HTTP error! status: ${response.status} ${await response.text()}`
    );
  }
  const body = await response.json();
  console.log("Response from server:", body);
}

main().catch((error) => {
  console.error("Error in client:", error);
  process.exit(1);
});
```

## Project Structure

```
├── server.ts          # Main Express server with x402 middleware
├── .env               # Environment variables (create this)
├── .env.example       # Environment variables template
├── package.json       # Dependencies and scripts
├── tsconfig.json      # TypeScript configuration
└── README.md          # This file
```

## Dependencies

### Core x402 Libraries
- `@x402/express` - Express middleware for x402 payment protocol
- `@x402/core` - Core x402 types and utilities
- `@x402/evm` - EVM-based payment schemes (ExactEvmScheme)
- `@x402/paywall` - Browser wallet connection UI

### Payment Infrastructure
- `stripe` - Stripe API client for crypto PaymentIntents
- `@coinbase/cdp-sdk` - Coinbase Developer Platform SDK for JWT auth
- `node-cache` - In-memory caching with TTL support

### Utilities
- `express` - Web framework
- `dotenv` - Environment variable management
- `viem` - Ethereum utilities (used by x402 libraries)
- `crypto` - Node.js crypto module (polyfilled for CDP SDK)

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

## Technical Details

### Payment Amount Calculation

The server uses USDC (6 decimals) with an amount of `10000` (smallest units):
```typescript
const decimals = 6; // USDC has 6 decimals
const amountInCents = Number(10000) / Math.pow(10, decimals - 2);
// 10000 / 10^4 = 1 cent = $0.01
```

### Stripe PaymentIntent Configuration

```typescript
{
  amount: 1,                         // $0.01 in USD cents
  currency: "usd",
  payment_method_types: ["crypto"],
  payment_method_options: {
    crypto: { mode: "custom" }       // Beta feature for custom networks
  },
  confirm: true                       // Auto-confirm to get deposit address
}
```

### Address Normalization Fix

**Critical**: All Ethereum addresses are normalized to lowercase before caching/comparison. This prevents issues where:
- Payment signature contains mixed-case address: `0xAbC...`
- Cache lookup fails due to case mismatch
- Verification cannot proceed

Solution:
```typescript
const normalizedAddress = toAddress.toLowerCase();
const cached = paymentCache.get(normalizedAddress);
```

### ExactEvmScheme

Uses the "exact" payment scheme which requires:
- Exact amount match (10000 USDC smallest units)
- Exact recipient address (Stripe deposit address)
- Payment on specified network (Base mainnet)
- Transfer authorization signature (EIP-3712)

### Crypto Polyfill

The server includes a crypto polyfill for the CDP SDK:
```typescript
import crypto from "crypto";
globalThis.crypto = crypto.webcrypto as any;
```

This is required because the CDP SDK expects Web Crypto API, but Node.js uses a different crypto module.

### ESM Configuration

The project uses ESM modules (`"type": "module"` in package.json) with these configurations:

**tsconfig.json:**
```json
{
  "compilerOptions": {
    "module": "ES2020",
    "moduleResolution": "node16"
  },
  "ts-node": {
    "esm": true,
    "experimentalSpecifierResolution": "node"
  }
}
```

This ensures compatibility with the CDP SDK and other ESM-only packages.

## Troubleshooting

### "Server stops running immediately"

**This is expected behavior!** The server doesn't stop - it stays running and waits for requests. When you run `npm start`:

```bash
$ npm start
> ts-node server.ts

Server is running on http://localhost:3000
# Terminal appears to "hang" here - this is NORMAL
```

The terminal appears to hang because the server process is actively running. To stop it, press `Ctrl+C`.

### "Cannot verify payment signature"

Check the following:
1. ✅ Payment signature is sent in `payment-signature` header (lowercase)
2. ✅ Cache lookup is working (address normalized to lowercase)
3. ✅ Stripe deposit address matches the cached address
4. ✅ CDP API credentials are valid
5. ✅ Payment signature is for the correct network (eip155:8453)

Server logs will show:
```
💳 Created PaymentIntent pi_xxx... for $0.01 → 0x...
✅ Payment verified from 0x...
✅ Payment settled: 0x...
```

### "401 Unauthorized from CDP"

Your CDP API credentials are invalid or expired:
1. Check `CDP_KEY` and `CDP_API_KEY_SECRET` in `.env`
2. Verify credentials at https://portal.cdp.coinbase.com/
3. Ensure JWT token generation is working (check logs)

### "Stripe PaymentIntent creation failed"

1. ✅ `STRIPE_SECRET_KEY` is valid
2. ✅ Stripe account has crypto payments enabled
3. ✅ Using Stripe API version that supports crypto payments
4. ✅ Network access to Stripe API

### Ed25519 Warning

The warning about Ed25519 is harmless:
```
(node:xxx) ExperimentalWarning: The Ed25519 Web Crypto API algorithm is an experimental feature
```

This comes from the CDP SDK using Ed25519 for JWT signing. You can safely ignore it.

## Customization

### Change Payment Amount

Edit the `payTo` function in `server.ts`:

```typescript
// Change from $0.01 to $1.00
price: "$1.00",  // Update in middleware config

// Update in payTo function:
const amountInCents = Number(1000000) / Math.pow(10, decimals - 2);
// 1000000 USDC smallest units = $1.00
```

### Change Network

To use Base Sepolia testnet instead of mainnet:

```typescript
// In middleware config:
network: "eip155:84532",  // Base Sepolia

// Update facilitator URL in .env if needed
FACILITATOR_URL=https://api.cdp.coinbase.com/platform/v2/x402
```

### Change Cache TTL

Modify the cache configuration:

```typescript
// Change from 5 minutes to 10 minutes
const paymentCache = new NodeCache({ stdTTL: 600, checkperiod: 120 });
```

### Add More Endpoints

Add additional protected endpoints:

```typescript
app.use(
  paymentMiddleware(
    {
      "GET /api/data": { /* ... */ },
      "POST /api/submit": {
        accepts: [
          {
            scheme: "exact",
            price: "$0.05",
            network: "eip155:8453",
            payTo: async (context) => { /* ... */ }
          }
        ],
        description: "Submit data endpoint",
        mimeType: "application/json",
      }
    },
    /* ... */
  )
);

app.post("/api/submit", (req, res) => {
  // Handle submission
});
```

### Use Different Payment Token

To use a different token than USDC, update the asset address and decimals:

```typescript
// For USDT on Base (6 decimals):
// Asset: 0x... (USDT contract address)
const decimals = 6;

// For DAI on Base (18 decimals):
// Asset: 0x... (DAI contract address)
const decimals = 18;
const amountInCents = Number(10000000000000000) / Math.pow(10, decimals - 2);
```

## Resources

- [x402 Protocol Documentation](https://x402.org)
- [Stripe Crypto Payments](https://stripe.com/docs/crypto)
- [Coinbase Developer Platform](https://portal.cdp.coinbase.com/)
- [Base Network](https://base.org)
- [EIP-3712 Typed Structured Data](https://eips.ethereum.org/EIPS/eip-712)

## License

MIT
