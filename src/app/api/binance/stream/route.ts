import { NextResponse, type NextRequest } from "next/server";
import { getBinanceClient } from "../../../../server/binanceClient";

const encoder = new TextEncoder();

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

  const interval = intervalParam as BinanceInterval;

  try {
    const client = getBinanceClient();
    let cleanup: (() => void) | null = null;
    let keepAlive: NodeJS.Timeout | null = null;

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const send = (data: unknown) => {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(data)}\n\n`)
          );
        };

        keepAlive = setInterval(() => {
          controller.enqueue(encoder.encode(`: keep-alive\n\n`));
        }, 15000);

        cleanup = client.ws.candles(symbol, interval, (candle: any) => {
          send({
            candle: {
              startTime: candle.startTime,
              open: candle.open,
              high: candle.high,
              low: candle.low,
              close: candle.close,
              volume: candle.volume,
            },
          });
        });
      },
      cancel() {
        cleanup?.();
        if (keepAlive) {
          clearInterval(keepAlive);
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (error) {
    console.error("Failed to open Binance stream", error);
    return NextResponse.json(
      { error: "Failed to open Binance stream" },
      { status: 500 }
    );
  }
}
