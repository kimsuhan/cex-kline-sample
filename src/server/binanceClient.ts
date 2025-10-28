import binance, { type Binance } from "binance-api-node";

let client: Binance | null = null;

export function getBinanceClient(): Binance {
  if (!client) {
    client = binance();
  }
  return client;
}
