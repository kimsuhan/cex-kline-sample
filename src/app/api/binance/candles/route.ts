import { NextResponse, type NextRequest } from "next/server";
import { getBinanceClient } from "../../../../server/binanceClient";

export const runtime = "nodejs";

type BinanceInterval =
  | "1m"
  | "3m"
  | "5m"
  | "15m"
  | "30m"
  | "1h"
  | "2h"
  | "4h"
  | "6h"
  | "8h"
  | "12h"
  | "1d"
  | "3d"
  | "1w"
  | "1M";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const symbol = searchParams.get("symbol");
  const intervalParam = searchParams.get("interval");

  if (!symbol || !intervalParam) {
    return NextResponse.json(
      { error: "symbol and interval query parameters are required" },
      { status: 400 }
    );
  }

  try {
    const client = getBinanceClient();
    const candles = await client.candles({
      symbol,
      interval: intervalParam as BinanceInterval,
      limit: 600,
    });

    return NextResponse.json({ candles });
  } catch (error) {
    console.error("Failed to fetch Binance candles", error);
    return NextResponse.json(
      { error: "Failed to fetch Binance candles" },
      { status: 500 }
    );
  }
}
