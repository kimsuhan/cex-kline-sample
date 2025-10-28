import binance from "binance-api-node";

let client: any = null;

export function getBinanceClient() {
  if (!client) {
    client = binance();
  }
  return client;
}
