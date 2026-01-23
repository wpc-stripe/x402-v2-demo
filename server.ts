/**
 * x402 Payment-Protected Express Server
 *
 * This server demonstrates how to protect API endpoints with the x402 payment protocol
 * using Stripe crypto payments and Coinbase's Base facilitator.
 *
 * Key features:
 * - GET /api/data endpoint protected by a $0.01 payment requirement
 * - Dynamic Stripe PaymentIntent creation for crypto deposits
 * - Address caching to ensure payment retries use the same deposit address
 * - Coinbase CDP facilitator for payment verification and settlement on Base (eip155:8453)
 * - EIP-3712 transfer authorization for secure, gasless payments
 *
 * Environment variables required:
 * - FACILITATOR_URL: Coinbase CDP facilitator endpoint
 * - STRIPE_SECRET_KEY: Stripe API key with crypto payments enabled
 * - CDP_KEY: Coinbase Developer Platform API key ID
 * - CDP_API_KEY_SECRET: CDP API key secret for JWT authentication
 */

import { config } from "dotenv";
import express, { Request, Response } from "express";
import { paymentMiddleware, x402ResourceServer } from "@x402/express";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { ExactSvmScheme } from "@x402/svm/exact/server";
import { HTTPFacilitatorClient } from "@x402/core/server";
import Stripe from "stripe";
import { generateJwt } from "@coinbase/cdp-sdk/auth";
import crypto from "crypto";
import { createPaywall } from "@x402/paywall";
import { evmPaywall } from "@x402/paywall/evm";
import NodeCache from "node-cache";

// Cache to store PaymentIntent data by deposit address (5 minute TTL)
const paymentCache = new NodeCache({ stdTTL: 300, checkperiod: 60 });

const paywall = createPaywall()
  .withNetwork(evmPaywall)
  .withConfig({
    appName: "My App",
    testnet: false,
  })
  .build();

// Make crypto available globally for CDP SDK
globalThis.crypto = crypto.webcrypto as any;

config();

const facilitatorUrl = process.env.FACILITATOR_URL;
if (!facilitatorUrl) {
  console.error("❌ FACILITATOR_URL environment variable is required");
  process.exit(1);
}

const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
if (!stripeSecretKey) {
  console.error("❌ STRIPE_SECRET_KEY environment variable is required");
  process.exit(1);
}

// CDP API credentials for authenticating with the facilitator
const cdpApiKeyId = process.env.CDP_KEY;
const cdpApiKeySecret = process.env.CDP_API_KEY_SECRET;

if (!cdpApiKeyId || !cdpApiKeySecret) {
  console.error(
    "❌ CDP_KEY and CDP_API_KEY_SECRET environment variables are required",
  );
  process.exit(1);
}

/**
 * Configure the x402 facilitator client with Coinbase CDP authentication.
 * Generates separate JWT tokens for verify, settle, and supported endpoints.
 */
const facilitatorClient = new HTTPFacilitatorClient({
  url: facilitatorUrl,
  createAuthHeaders: async () => {
    const facilitatorUrlObj = new URL(facilitatorUrl);
    const facilitatorHost = facilitatorUrlObj.host;
    const basePath = facilitatorUrlObj.pathname;

    const verifyJwt = await generateJwt({
      apiKeyId: cdpApiKeyId,
      apiKeySecret: cdpApiKeySecret,
      requestMethod: "POST",
      requestHost: facilitatorHost,
      requestPath: `${basePath}/verify`,
      expiresIn: 120,
    });

    const settleJwt = await generateJwt({
      apiKeyId: cdpApiKeyId,
      apiKeySecret: cdpApiKeySecret,
      requestMethod: "POST",
      requestHost: facilitatorHost,
      requestPath: `${basePath}/settle`,
      expiresIn: 120,
    });

    const supportedJwt = await generateJwt({
      apiKeyId: cdpApiKeyId,
      apiKeySecret: cdpApiKeySecret,
      requestMethod: "GET",
      requestHost: facilitatorHost,
      requestPath: `${basePath}/supported`,
      expiresIn: 120,
    });

    return {
      verify: { Authorization: `Bearer ${verifyJwt}` },
      settle: { Authorization: `Bearer ${settleJwt}` },
      supported: { Authorization: `Bearer ${supportedJwt}` },
    };
  },
});

const stripe = new Stripe(stripeSecretKey);

/**
 * Creates a Stripe PaymentIntent for crypto payments and extracts the Base deposit address
 * @param amountInCents - Amount in USD cents (e.g., 1 = $0.01)
 * @returns PaymentIntent ID and deposit address
 */
async function createPaymentIntent(amountInCents: number) {
  const paymentIntent = await stripe.paymentIntents.create({
    amount: amountInCents,
    currency: "usd",
    payment_method_types: ["crypto"],
    payment_method_data: {
      type: "crypto",
    },
    payment_method_options: {
      crypto: {
        // @ts-ignore - Stripe crypto payments beta feature
        mode: "custom",
      },
    },
    confirm: true,
  });

  if (
    !paymentIntent.next_action ||
    !("crypto_collect_deposit_details" in paymentIntent.next_action)
  ) {
    throw new Error(
      "PaymentIntent did not return expected crypto deposit details",
    );
  }

  // @ts-ignore - crypto_collect_deposit_details is a beta feature
  const depositDetails = paymentIntent.next_action
    .crypto_collect_deposit_details as any;
  const payToAddress = depositDetails.deposit_addresses["base"]
    .address as string;

  console.log(
    `💳 Created PaymentIntent ${paymentIntent.id} for $${(
      amountInCents / 100
    ).toFixed(2)} → ${payToAddress}`,
  );

  return { paymentIntentId: paymentIntent.id, payToAddress };
}

/**
 * Extracts and normalizes the 'to' address from a base64-encoded payment header
 * @param paymentHeader - Base64-encoded payment signature header
 * @returns Normalized lowercase address or undefined if extraction fails
 */
function extractToAddressFromPaymentHeader(
  paymentHeader: string,
): string | undefined {
  try {
    const decoded = JSON.parse(Buffer.from(paymentHeader, "base64").toString());
    const toAddress = decoded.payload?.authorization?.to;

    if (toAddress && typeof toAddress === "string") {
      return toAddress.toLowerCase();
    }

    return undefined;
  } catch (e) {
    console.error("Failed to decode payment header:", e);
    return undefined;
  }
}

const app = express();
const PORT = 3000;

app.use(express.json());

app.use(
  paymentMiddleware(
    {
      "GET /api/data": {
        accepts: [
          {
            scheme: "exact",
            price: "$0.01",
            network: "eip155:8453",
            /**
             * Dynamic payTo function that:
             * 1. Checks if payment signature contains a cached deposit address
             * 2. If cached, reuses the same address (for payment retries)
             * 3. If not cached, creates a new Stripe PaymentIntent
             */
            payTo: async (context) => {
              // Check if this is a retry with an existing payment signature
              if (context.paymentHeader) {
                const normalizedAddress = extractToAddressFromPaymentHeader(
                  context.paymentHeader,
                );

                if (normalizedAddress) {
                  const cached = paymentCache.get(normalizedAddress);

                  if (cached) {
                    // Reuse existing PaymentIntent address for payment retry
                    return normalizedAddress as `0x${string}`;
                  }
                }
              }

              // Create new Stripe PaymentIntent
              const decimals = 6; // USDC has 6 decimals
              const amountInCents = Number(10000) / Math.pow(10, decimals - 2);

              const { payToAddress, paymentIntentId } =
                await createPaymentIntent(amountInCents);

              // Cache the PaymentIntent data (5 minute TTL from NodeCache config)
              paymentCache.set(payToAddress.toLowerCase(), {
                amount: amountInCents,
                paymentIntentId: paymentIntentId,
              });

              return payToAddress as `0x${string}`;
            },
          },
          {
            scheme: "exact",
            price: "$0.01",
            network: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp",
            payTo: process.env.SOLANA_PAY_TO!,
          },
        ],
        description: "Data retrieval endpoint",
        mimeType: "application/json",
      },
    },
    new x402ResourceServer(facilitatorClient)
      .register("eip155:8453", new ExactEvmScheme())
      .register("solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp", new ExactSvmScheme())
      .onBeforeVerify(async (context) => {
        console.log("🔍 Verifying payment...");
      })
      .onAfterVerify(async (context) => {
        console.log(`✅ Payment verified from ${context.result.payer}`);
      })
      .onVerifyFailure(async (context) => {
        console.error("❌ Payment verification failed:", context.error);
      })
      .onBeforeSettle(async (context) => {
        console.log("🔍 Settling payment...", JSON.stringify(context, null, 2));
      })
      .onAfterSettle(async (context) => {
        console.log(`✅ Payment settled: ${context.result.transaction}`);
      })
      .onSettleFailure(async (context) => {
        console.error("❌ Payment settlement failed:", context.error);
      }),
    undefined,
    paywall,
  ),
);

app.get("/api/data", (_req: Request, res: Response) => {
  res.json({
    success: true,
    message: "Data retrieved successfully",
    data: {
      timestamp: new Date().toISOString(),
      info: "This is protected data behind a paywall",
    },
  });
});

app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
