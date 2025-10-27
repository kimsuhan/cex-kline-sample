"use client";

import type { ChangeEvent } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { createClient, type Client } from "graphql-ws";
import {
  ColorType,
  createChart,
  CandlestickSeries,
  type CandlestickData,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
} from "lightweight-charts";
import styles from "./page.module.css";

type Candle = {
  openTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
};

type SubscriptionEvent = {
  id: string;
  symbol: string;
  close: number;
  openTime: number;
};

type GraphQLSymbol = {
  symbol: string;
  is_active: boolean;
};

type GraphQLKline = {
  symbol: string | null;
  timestampz: string;
  open: string;
  high: string;
  low: string;
  close: string;
};

const CANDLES_TO_SHOW = 60;

const priceFormatter = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const timeFormatter = new Intl.DateTimeFormat("ko-KR", {
  hour: "2-digit",
  minute: "2-digit",
});

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:58001";

type GraphQLResponse<T> = {
  data?: T;
  errors?: { message: string }[];
};

async function fetchGraphQL<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
  const response = await fetch(`${apiUrl}/graphql`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!response.ok) {
    throw new Error(`GraphQL request failed with status ${response.status}`);
  }

  const payload = (await response.json()) as GraphQLResponse<T>;

  if (payload.errors?.length) {
    throw new Error(payload.errors.map((item) => item.message).join(", "));
  }

  if (!payload.data) {
    throw new Error("GraphQL response did not include data");
  }

  return payload.data;
}

const buildWsUrl = () => {
  const normalized = apiUrl.endsWith("/") ? apiUrl.slice(0, -1) : apiUrl;
  return `${normalized.replace(/^http/i, "ws")}/graphql`;
};

let wsClient: Client | null = null;

const getWsClient = () => {
  if (!wsClient) {
    wsClient = createClient({
      url: buildWsUrl(),
      lazy: true,
      retryAttempts: 25,
      shouldRetry: () => true,
    });
  }
  return wsClient;
};

function mapKlineToCandle(kline: GraphQLKline): Candle | null {
  const rawTimestamp = kline.timestampz?.trim();
  let openTime = Number.NaN;

  if (rawTimestamp) {
    if (/^\d+$/.test(rawTimestamp)) {
      // Support both second and millisecond epoch formats
      openTime = rawTimestamp.length <= 10 ? Number(rawTimestamp) * 1000 : Number(rawTimestamp);
    } else {
      openTime = Date.parse(rawTimestamp);
    }
  }

  const open = parseFloat(kline.open);
  const high = parseFloat(kline.high);
  const low = parseFloat(kline.low);
  const close = parseFloat(kline.close);

  if (Number.isNaN(openTime) || Number.isNaN(open) || Number.isNaN(high) || Number.isNaN(low) || Number.isNaN(close)) {
    return null;
  }

  return {
    openTime,
    open,
    high,
    low,
    close,
  } satisfies Candle;
}

function mapKlinesToCandles(klines: GraphQLKline[]): Candle[] {
  return klines
    .map((item) => mapKlineToCandle(item))
    .filter((value): value is Candle => value !== null)
    .sort((a, b) => a.openTime - b.openTime);
}

const toSeriesData = (candles: Candle[]): CandlestickData[] =>
  candles.map((candle) => ({
    time: Math.floor(candle.openTime / 1000) as UTCTimestamp,
    open: candle.open,
    high: candle.high,
    low: candle.low,
    close: candle.close,
  }));

type MinuteChartProps = {
  data: Candle[];
  symbol: string;
};

function MinuteChart({ data, symbol }: MinuteChartProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const initialRenderRef = useRef(true);
  const lastSymbolRef = useRef<string | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || chartRef.current) {
      return;
    }

    const chart = createChart(container, {
      width: container.clientWidth,
      height: container.clientHeight,
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: "rgba(226, 232, 240, 0.85)",
      },
      grid: {
        horzLines: { color: "rgba(148, 163, 184, 0.08)" },
        vertLines: { color: "rgba(148, 163, 184, 0.08)" },
      },
      crosshair: {
        vertLine: { color: "rgba(148, 163, 184, 0.35)", labelBackgroundColor: "rgba(100, 116, 139, 0.65)" },
        horzLine: { color: "rgba(148, 163, 184, 0.35)", labelBackgroundColor: "rgba(100, 116, 139, 0.65)" },
      },
      rightPriceScale: {
        borderColor: "rgba(148, 163, 184, 0.2)",
      },
      timeScale: {
        borderColor: "rgba(148, 163, 184, 0.2)",
        rightOffset: 4,
        barSpacing: 8,
      },
    });

    const series = chart.addSeries(CandlestickSeries, {
      upColor: "#34d399",
      downColor: "#fb7185",
      wickUpColor: "#34d399",
      wickDownColor: "#fb7185",
      borderUpColor: "#34d399",
      borderDownColor: "#fb7185",
    });

    chartRef.current = chart;
    seriesRef.current = series;

    const handleResize = () => {
      if (!container) {
        return;
      }
      chart.applyOptions({ width: container.clientWidth, height: container.clientHeight });
    };

    const resizeObserver = typeof ResizeObserver !== "undefined" ? new ResizeObserver(handleResize) : null;

    if (resizeObserver) {
      resizeObserver.observe(container);
    }

    handleResize();

    return () => {
      resizeObserver?.disconnect();
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
      initialRenderRef.current = true;
      lastSymbolRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (lastSymbolRef.current !== symbol) {
      lastSymbolRef.current = symbol;
      initialRenderRef.current = true;
    }

    const series = seriesRef.current;
    const chart = chartRef.current;

    if (!series) {
      return;
    }

    if (!data.length) {
      series.setData([]);
      return;
    }

    const seriesData = toSeriesData(data);
    series.setData(seriesData);

    if (initialRenderRef.current) {
      chart?.timeScale().fitContent();
      initialRenderRef.current = false;
    } else {
      chart?.timeScale().scrollToRealTime();
    }
  }, [data, symbol]);

  return (
    <div className={styles.chartRoot}>
      <div ref={containerRef} className={styles.chartContainer} />
      {data.length === 0 && <div className={styles.chartPlaceholder}>데이터를 불러오는 중입니다…</div>}
    </div>
  );
}

export default function Home() {
  const [selectedSymbol, setSelectedSymbol] = useState("");
  const [symbolOptions, setSymbolOptions] = useState<string[]>([]);
  const [candles, setCandles] = useState<Candle[]>([]);
  const [events, setEvents] = useState<SubscriptionEvent[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const latestCandle = useMemo(() => candles[candles.length - 1], [candles]);

  useEffect(() => {
    let cancelled = false;

    const fetchSymbols = async () => {
      try {
        const data = await fetchGraphQL<{ symbols: GraphQLSymbol[] }>(
          `query Symbols {
            symbols {
              symbol
              is_active
            }
          }`
        );

        if (cancelled) {
          return;
        }

        const activeSymbols = data.symbols.filter((item) => item.is_active).map((item) => item.symbol);
        setSymbolOptions(activeSymbols);
        if (!selectedSymbol && activeSymbols.length > 0) {
          setSelectedSymbol(activeSymbols[0]);
        }
      } catch (error) {
        console.error("Failed to fetch symbols", error);
        if (!cancelled) {
          setErrorMessage("심볼 목록을 불러오지 못했습니다.");
        }
      }
    };

    fetchSymbols();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!selectedSymbol) {
      return;
    }

    let cancelled = false;

    const fetchKlines = async () => {
      setIsStreaming(false);
      setErrorMessage(null);

      try {
        const data = await fetchGraphQL<{ getOneMinuteDatas: GraphQLKline[] }>(
          `query OneMinute($symbol: String!) {
            getOneMinuteDatas(symbol: $symbol) {
              symbol
              timestampz
              open
              high
              low
              close
            }
          }`,
          { symbol: selectedSymbol }
        );

        if (cancelled) {
          return;
        }

        const mappedCandles = mapKlinesToCandles(data.getOneMinuteDatas).slice(-CANDLES_TO_SHOW);
        setCandles(mappedCandles);
        setEvents(
          mappedCandles
            .slice(-6)
            .reverse()
            .map((candle) => ({
              id: `${candle.openTime}`,
              symbol: selectedSymbol,
              close: candle.close,
              openTime: candle.openTime,
            }))
        );
        setIsStreaming(true);
      } catch (error) {
        console.error("Failed to fetch kline data", error);
        if (!cancelled) {
          setCandles([]);
          setEvents([]);
          setIsStreaming(false);
          setErrorMessage("분봉 데이터를 불러오지 못했습니다.");
        }
      }
    };

    fetchKlines();

    return () => {
      cancelled = true;
    };
  }, [selectedSymbol]);

  useEffect(() => {
    if (!selectedSymbol) {
      return;
    }

    let active = true;
    const client = getWsClient();

    const dispose = client.subscribe(
      {
        query: `subscription KlineUpdated($symbol: String!) {
          klineUpdated(symbol: $symbol) {
            symbol
            timestampz
            open
            high
            low
            close
          }
        }`,
        variables: { symbol: selectedSymbol },
      },
      {
        next: (result) => {
          if (!active) {
            return;
          }

          if (result.errors?.length) {
            console.error("Subscription returned errors", result.errors);
            setErrorMessage("실시간 데이터를 수신하는 중 오류가 발생했습니다.");
            setIsStreaming(false);
            return;
          }

          const payload = result.data?.klineUpdated;
          if (!payload) {
            return;
          }

          const candle = mapKlineToCandle(payload);
          if (!candle) {
            return;
          }

          setCandles((previous) => {
            if (previous.length === 0) {
              return [candle];
            }

            const existingIndex = previous.findIndex((item) => item.openTime === candle.openTime);

            if (existingIndex !== -1) {
              const nextCandles = [...previous];
              nextCandles[existingIndex] = candle;
              return nextCandles;
            }

            const nextCandles = [...previous.slice(-(CANDLES_TO_SHOW - 1)), candle];
            return nextCandles.sort((a, b) => a.openTime - b.openTime);
          });

          setEvents((prevEvents) => {
            const nextEvent: SubscriptionEvent = {
              id: `${candle.openTime}`,
              symbol: payload.symbol ?? selectedSymbol,
              close: candle.close,
              openTime: candle.openTime,
            };

            const deduped = prevEvents.filter((event) => event.id !== nextEvent.id);
            return [nextEvent, ...deduped].slice(0, 6);
          });

          setIsStreaming(true);
        },
        error: (error) => {
          if (!active) {
            return;
          }
          console.error("Subscription error", error);
          setIsStreaming(false);
          setErrorMessage("실시간 데이터 연결이 종료되었습니다.");
        },
        complete: () => {
          if (!active) {
            return;
          }
          setIsStreaming(false);
        },
      }
    );

    return () => {
      active = false;
      dispose();
    };
  }, [selectedSymbol]);

  const handleSymbolChange = (event: ChangeEvent<HTMLSelectElement>) => {
    const nextSymbol = event.target.value;
    setSelectedSymbol(nextSymbol);
  };

  return (
    <div className={styles.page}>
      <main className={styles.container}>
        <header className={styles.header}>
          <div>
            <h1 className={styles.title}>분봉 구독 샘플</h1>
            <p className={styles.subtitle}>
              GraphQL Subscription 흐름을 시각화한 목업입니다. API 엔드포인트는 <strong>{apiUrl}</strong> 으로
              설정되어 있습니다.
            </p>
          </div>
          <label className={styles.selector}>
            <span>심볼 선택</span>
            <select value={selectedSymbol} onChange={handleSymbolChange} disabled={symbolOptions.length === 0}>
              {symbolOptions.map((symbol) => (
                <option key={symbol} value={symbol}>
                  {symbol}
                </option>
              ))}
            </select>
          </label>
        </header>

        <section className={styles.chartCard}>
          <div className={styles.chartHeader}>
            <div>
              <h2>{selectedSymbol || "심볼을 선택하세요"}</h2>
              <p>1분 봉 기준 실시간 데이터</p>
            </div>
            {latestCandle && (
              <div className={styles.priceSnapshot}>
                <span className={styles.priceLabel}>현재가</span>
                <strong className={styles.priceValue}>{priceFormatter.format(latestCandle.close)}</strong>
                <span className={styles.timeValue}>{timeFormatter.format(latestCandle.openTime)}</span>
              </div>
            )}
          </div>
          <div className={styles.chartWrapper}>
            <MinuteChart data={candles} symbol={selectedSymbol} />
          </div>
        </section>

        <section className={styles.subscriptionCard}>
          <div className={styles.subscriptionHeader}>
            <div className={styles.statusRow}>
              <span
                className={`${styles.statusDot} ${isStreaming ? styles.connected : styles.pending}`}
                aria-hidden
              />
              <h2>GraphQL Subscription (샘플)</h2>
            </div>
            <span className={styles.statusText}>{isStreaming ? "연결됨" : "연결 중"}</span>
          </div>
          {errorMessage && <p className={styles.errorMessage}>{errorMessage}</p>}
          <ul className={styles.eventList}>
            {events.length === 0 && <li className={styles.eventPlaceholder}>최근에 수신한 데이터가 없습니다.</li>}
            {events.map((event) => (
              <li key={event.id} className={styles.eventItem}>
                <span className={styles.eventSymbol}>{event.symbol}</span>
                <span className={styles.eventPrice}>{priceFormatter.format(event.close)}</span>
                <span className={styles.eventTime}>{timeFormatter.format(event.openTime)}</span>
              </li>
            ))}
          </ul>
        </section>
      </main>
    </div>
  );
}
