// Usage: ./node_modules/.bin/tsx client.ts
// https://github.com/coinbase/x402/blob/main/docs/guides/migration-v1-to-v2.md
import { wrapFetchWithPayment, x402Client } from "@x402/fetch";
import { registerExactEvmScheme } from "@x402/evm/exact/client";
import { privateKeyToAccount } from "viem/accounts";
import { webcrypto } from "crypto";

globalThis.crypto = webcrypto as any;

if (!process.env.EVM_PRIVATE_KEY) {
  console.error("You must pass an EVM_PRIVATE_KEY to sign x402 requests");
}

const account = privateKeyToAccount(
  process.env.EVM_PRIVATE_KEY as `0x${string}`
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
