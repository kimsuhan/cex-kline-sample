"use client";

import { Chart, type ChartDataset } from "chart.js";
import { createClient, type Client } from "graphql-ws";
import type { ChangeEvent } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ensureFinancialChartRegistered } from "./lib/registerFinancialChart";
import styles from "./page.module.css";

type CandlestickDataPoint = {
  x: number; // Timestamp or numerical x-coordinate
  o: number; // Open value
  h: number; // High value
  l: number; // Low value
  c: number; // Close value
};

// Extended dataset type for candlestick charts
type CandlestickDataset = ChartDataset<
  "candlestick",
  CandlestickDataPoint[]
> & {
  upColor?: string;
  downColor?: string;
  borderColor?: string;
  borderUpColor?: string;
  borderDownColor?: string;
  wickUpColor?: string;
  wickDownColor?: string;
};

type Candle = {
  openTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
};

type GraphQLSymbol = {
  id: string;
  is_active: boolean;
  created_at?: string;
  updated_at?: string;
};

type KlineModel = {
  symbol: string | null;
  interval: number;
  candleTime: string | null;
  open: string;
  close: string;
  high: string;
  low: string;
  volume: number | null;
};

type KlineSubModel = {
  symbol: string | null;
  interval: number;
  candleTime: string;
  open: string;
  high: string;
  low: string;
  close: string;
  volume: number | null;
};

type BinanceRestCandlePayload = {
  openTime: number;
  open: string;
  high: string;
  low: string;
  close: string;
  volume: string;
};

type BinanceStreamCandlePayload = {
  startTime: number;
  open: string;
  high: string;
  low: string;
  close: string;
  volume: string;
};

const DEFAULT_INTERVAL_MINUTES = 1;
const MAX_CANDLES = 500;
const TARGET_BAR_COUNT = 180;
const INTERVAL_OPTIONS = [1, 3, 5, 15, 30, 60, 120, 240];
const BINANCE_INTERVAL_MAP = {
  1: "1m",
  3: "3m",
  5: "5m",
  15: "15m",
  30: "30m",
  60: "1h",
  120: "2h",
  240: "4h",
} as const;
type BinanceInterval =
  (typeof BINANCE_INTERVAL_MAP)[keyof typeof BINANCE_INTERVAL_MAP];

const priceFormatter = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const percentFormatter = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const volumeFormatter = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 0,
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

async function fetchGraphQL<T>(
  query: string,
  variables?: Record<string, unknown>
): Promise<T> {
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

function mapSubscriptionKlineToCandle(kline: KlineSubModel): Candle | null {
  const openTime = Date.parse(kline.candleTime);
  const open = parseFloat(kline.open);
  const high = parseFloat(kline.high);
  const low = parseFloat(kline.low);
  const close = parseFloat(kline.close);
  const volume =
    typeof kline.volume === "number" ? kline.volume : Number(kline.volume ?? 0);

  if (
    Number.isNaN(openTime) ||
    Number.isNaN(open) ||
    Number.isNaN(high) ||
    Number.isNaN(low) ||
    Number.isNaN(close)
  ) {
    return null;
  }

  return {
    openTime,
    open,
    high,
    low,
    close,
    volume: Number.isNaN(volume) ? undefined : volume,
  } satisfies Candle;
}

function mapModelToCandle(model: KlineModel): Candle | null {
  const openTime = model.candleTime ? Date.parse(model.candleTime) : Number.NaN;
  const open = parseFloat(model.open);
  const high = parseFloat(model.high);
  const low = parseFloat(model.low);
  const close = parseFloat(model.close);
  const volume =
    typeof model.volume === "number"
      ? model.volume
      : Number(model.volume ?? Number.NaN);

  if (
    Number.isNaN(openTime) ||
    Number.isNaN(open) ||
    Number.isNaN(high) ||
    Number.isNaN(low) ||
    Number.isNaN(close)
  ) {
    return null;
  }

  return {
    openTime,
    open,
    high,
    low,
    close,
    volume: Number.isNaN(volume) ? undefined : volume,
  } satisfies Candle;
}

function mapModelsToCandles(klines: KlineModel[]): Candle[] {
  return klines
    .map((item) => mapModelToCandle(item))
    .filter((value): value is Candle => value !== null)
    .sort((a, b) => a.openTime - b.openTime);
}

const normalizeBinanceSymbol = (symbol: string): string => {
  if (!symbol) {
    return "";
  }
  const normalized = symbol.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
  if (normalized.length === 0) {
    return "";
  }
  return normalized.endsWith("USDT") ? normalized : `${normalized}USDT`;
};

function mapBinanceRestCandle(
  payload: BinanceRestCandlePayload
): Candle | null {
  const openTime = payload.openTime;
  const open = parseFloat(payload.open);
  const high = parseFloat(payload.high);
  const low = parseFloat(payload.low);
  const close = parseFloat(payload.close);
  const volume = parseFloat(payload.volume);

  if (
    Number.isNaN(openTime) ||
    Number.isNaN(open) ||
    Number.isNaN(high) ||
    Number.isNaN(low) ||
    Number.isNaN(close)
  ) {
    return null;
  }

  return {
    openTime,
    open,
    high,
    low,
    close,
    volume: Number.isNaN(volume) ? undefined : volume,
  } satisfies Candle;
}

function mapBinanceStreamCandle(
  payload: BinanceStreamCandlePayload
): Candle | null {
  const openTime = payload.startTime;
  const open = parseFloat(payload.open);
  const high = parseFloat(payload.high);
  const low = parseFloat(payload.low);
  const close = parseFloat(payload.close);
  const volume = parseFloat(payload.volume);

  if (
    Number.isNaN(openTime) ||
    Number.isNaN(open) ||
    Number.isNaN(high) ||
    Number.isNaN(low) ||
    Number.isNaN(close)
  ) {
    return null;
  }

  return {
    openTime,
    open,
    high,
    low,
    close,
    volume: Number.isNaN(volume) ? undefined : volume,
  } satisfies Candle;
}

const pickIntervalForRange = (rangeMinutes: number): number => {
  for (const option of INTERVAL_OPTIONS) {
    if (rangeMinutes / option <= TARGET_BAR_COUNT) {
      return option;
    }
  }

  return INTERVAL_OPTIONS[INTERVAL_OPTIONS.length - 1];
};

const toCandlestickPoints = (candles: Candle[]): CandlestickDataPoint[] =>
  candles.map((candle) => ({
    x: candle.openTime,
    o: candle.open,
    h: candle.high,
    l: candle.low,
    c: candle.close,
  }));

type MinuteChartProps = {
  data: Candle[];
  symbol: string;
  intervalMinutes: number;
  onZoomRangeChange?: (rangeMs: number) => void;
};

function MinuteChart({
  data,
  symbol,
  intervalMinutes,
  onZoomRangeChange,
}: MinuteChartProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const chartRef = useRef<Chart | null>(null);
  const initialRenderRef = useRef(true);
  const lastSymbolRef = useRef<string | null>(null);
  const lastIntervalRef = useRef<number | null>(null);
  const zoomCallbackRef = useRef<typeof onZoomRangeChange | undefined>(
    undefined
  );

  useEffect(() => {
    zoomCallbackRef.current = onZoomRangeChange;
  }, [onZoomRangeChange]);

  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;

    if (!container || !canvas || chartRef.current) {
      return;
    }

    let disposed = false;
    let resizeObserver: ResizeObserver | null = null;
    let chartInstance: Chart | null = null;

    const notifyRangeChange = (chart: Chart) => {
      const callback = zoomCallbackRef.current;
      if (!callback) {
        return;
      }

      const xScale = chart.scales.x;
      const min = (xScale?.min ?? null) as number | null;
      const max = (xScale?.max ?? null) as number | null;

      if (min !== null && max !== null) {
        callback(max - min);
      }
    };

    const initializeChart = async () => {
      await ensureFinancialChartRegistered();

      if (disposed || !container || !canvas) {
        return;
      }

      const chart = new Chart(canvas, {
        type: "candlestick",
        data: {
          datasets: [
            {
              label: "",
              data: [] as CandlestickDataPoint[],
              upColor: "#34d399",
              downColor: "#fb7185",
              borderColor: "rgba(148, 163, 184, 0.25)",
              borderUpColor: "#34d399",
              borderDownColor: "#fb7185",
              wickUpColor: "#34d399",
              wickDownColor: "#fb7185",
            } as CandlestickDataset,
          ],
        },
        options: {
          animation: false,
          responsive: true,
          maintainAspectRatio: false,
          parsing: false,
          interaction: {
            mode: "nearest",
            intersect: false,
          },
          plugins: {
            legend: {
              display: false,
            },
            tooltip: {
              callbacks: {
                label: (context) => {
                  const raw = context.raw as CandlestickDataPoint | undefined;

                  if (!raw) {
                    return "";
                  }

                  return [
                    `시가: ${priceFormatter.format(raw.o)}`,
                    `고가: ${priceFormatter.format(raw.h)}`,
                    `저가: ${priceFormatter.format(raw.l)}`,
                    `종가: ${priceFormatter.format(raw.c)}`,
                  ];
                },
              },
            },
            zoom: {
              limits: {
                y: { min: "original", max: "original" },
              },
              pan: {
                enabled: true,
                mode: "x",
              },
              zoom: {
                wheel: {
                  enabled: true,
                },
                pinch: {
                  enabled: true,
                },
                mode: "x",
              },
            } as Record<string, unknown>,
          },
          scales: {
            x: {
              type: "time",
              time: {
                unit: "minute",
                tooltipFormat: "HH:mm",
                displayFormats: {
                  minute: "HH:mm",
                },
              },
              grid: {
                color: "rgba(148, 163, 184, 0.08)",
              },
              ticks: {
                color: "rgba(226, 232, 240, 0.65)",
                maxRotation: 0,
                source: "data",
              },
              border: {
                color: "rgba(148, 163, 184, 0.2)",
              },
            },
            y: {
              position: "right",
              grid: {
                color: "rgba(148, 163, 184, 0.08)",
              },
              ticks: {
                color: "rgba(226, 232, 240, 0.7)",
                callback: (value) => priceFormatter.format(Number(value)),
              },
              border: {
                color: "rgba(148, 163, 184, 0.2)",
              },
            },
          },
        },
      });

      chartRef.current = chart;
      chartInstance = chart;

      // Add zoom event listeners after chart creation
      if (chart.options.plugins?.zoom) {
        (chart.options.plugins.zoom as Record<string, unknown>).onZoomComplete =
          ({ chart: zoomedChart }: { chart: Chart }) =>
            notifyRangeChange(zoomedChart);
        (chart.options.plugins.zoom as Record<string, unknown>).onPanComplete =
          ({ chart: pannedChart }: { chart: Chart }) =>
            notifyRangeChange(pannedChart);
      }

      resizeObserver =
        typeof ResizeObserver !== "undefined"
          ? new ResizeObserver(() => chart.resize())
          : null;

      if (resizeObserver) {
        resizeObserver.observe(container);
      }

      notifyRangeChange(chart);
    };

    void initializeChart();

    return () => {
      disposed = true;
      resizeObserver?.disconnect();
      chartInstance?.destroy();
      chartRef.current = null;
      initialRenderRef.current = true;
      lastSymbolRef.current = null;
      lastIntervalRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (lastSymbolRef.current !== symbol) {
      lastSymbolRef.current = symbol;
      initialRenderRef.current = true;
    }

    if (lastIntervalRef.current !== intervalMinutes) {
      lastIntervalRef.current = intervalMinutes;
      initialRenderRef.current = true;
    }

    const chart = chartRef.current;

    if (!chart) {
      return;
    }

    const dataset = chart.data.datasets[0] as CandlestickDataset;

    if (!data.length) {
      dataset.data = [];
      chart.update("none");
      return;
    }

    dataset.label = symbol ? `${symbol} ${intervalMinutes}분봉` : dataset.label;
    dataset.data = toCandlestickPoints(data);

    if (initialRenderRef.current) {
      if (
        typeof (chart as unknown as Record<string, unknown>).resetZoom ===
        "function"
      ) {
        (
          (chart as unknown as Record<string, unknown>).resetZoom as () => void
        )();
      }
      chart.update("none");
      initialRenderRef.current = false;
    } else {
      chart.update();
    }

    setTimeout(() => {
      const callback = zoomCallbackRef.current;
      if (callback) {
        const xScale = chart.scales.x;
        const min = (xScale?.min ?? null) as number | null;
        const max = (xScale?.max ?? null) as number | null;
        if (min !== null && max !== null) {
          callback(max - min);
        }
      }
    }, 0);
  }, [data, symbol, intervalMinutes]);

  return (
    <div className={styles.chartRoot}>
      <div ref={containerRef} className={styles.chartContainer}>
        <canvas ref={canvasRef} className={styles.chartCanvas} />
      </div>
      {data.length === 0 && (
        <div className={styles.chartPlaceholder}>
          데이터를 불러오는 중입니다…
        </div>
      )}
    </div>
  );
}

export default function Home() {
  const [selectedSymbol, setSelectedSymbol] = useState("");
  const [symbolOptions, setSymbolOptions] = useState<GraphQLSymbol[]>([]);
  const [candles, setCandles] = useState<Candle[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [intervalMode, setIntervalMode] = useState<"auto" | number>("auto");
  const [selectedInterval, setSelectedInterval] = useState(
    DEFAULT_INTERVAL_MINUTES
  );
  const [binanceCandles, setBinanceCandles] = useState<Candle[]>([]);
  const [binanceStatus, setBinanceStatus] = useState<
    "idle" | "connecting" | "connected" | "error"
  >("idle");
  const [binanceErrorMessage, setBinanceErrorMessage] = useState<string | null>(
    null
  );

  const refreshTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const latestCandle = useMemo(() => candles[candles.length - 1], [candles]);
  const latestBinanceCandle = useMemo(
    () => binanceCandles[binanceCandles.length - 1],
    [binanceCandles]
  );
  const binanceSymbol = useMemo(
    () => normalizeBinanceSymbol(selectedSymbol),
    [selectedSymbol]
  );
  const differenceSummary = useMemo(() => {
    if (!latestCandle || !latestBinanceCandle) {
      return null;
    }

    const buildMetric = (
      label: string,
      localValue: number | undefined,
      binanceValue: number | undefined,
      formatter: "price" | "volume"
    ) => {
      if (
        localValue === undefined ||
        Number.isNaN(localValue) ||
        binanceValue === undefined ||
        Number.isNaN(binanceValue)
      ) {
        return null;
      }

      const diff = binanceValue - localValue;
      const percent = localValue === 0 ? null : (diff / localValue) * 100;
      return {
        label,
        localValue,
        binanceValue,
        diff,
        percent,
        formatter,
      } as const;
    };

    const metrics = [
      buildMetric("시가", latestCandle.open, latestBinanceCandle.open, "price"),
      buildMetric("고가", latestCandle.high, latestBinanceCandle.high, "price"),
      buildMetric("저가", latestCandle.low, latestBinanceCandle.low, "price"),
      buildMetric(
        "종가",
        latestCandle.close,
        latestBinanceCandle.close,
        "price"
      ),
      buildMetric(
        "거래량",
        latestCandle.volume,
        latestBinanceCandle.volume,
        "volume"
      ),
    ].filter((value): value is NonNullable<typeof value> => value !== null);

    const timeDiffMinutes =
      (latestBinanceCandle.openTime - latestCandle.openTime) / 60000;

    return {
      metrics,
      timeDiffMinutes,
      localOpenTime: latestCandle.openTime,
      binanceOpenTime: latestBinanceCandle.openTime,
    };
  }, [latestBinanceCandle, latestCandle]);

  const applyCandles = useCallback((nextCandles: Candle[]) => {
    setCandles(nextCandles);
  }, []);

  const fetchCandles = useCallback(
    async (symbol: string, intervalMinutes: number) => {
      const data = await fetchGraphQL<{ klines: KlineModel[] }>(
        `query Klines($input: KlineInput!) {
        klines(input: $input) {
          symbol
          interval
          candleTime
          open
          close
          high
          low
          volume
        }
      }`,
        { input: { symbol, intervalMin: intervalMinutes } }
      );

      return mapModelsToCandles(data.klines).slice(-MAX_CANDLES);
    },
    []
  );

  const queueSilentRefresh = useCallback(() => {
    if (!selectedSymbol) {
      return;
    }

    if (refreshTimeoutRef.current) {
      return;
    }

    refreshTimeoutRef.current = setTimeout(async () => {
      refreshTimeoutRef.current = null;
      try {
        const refreshed = await fetchCandles(selectedSymbol, selectedInterval);
        applyCandles(refreshed);
      } catch (error) {
        console.error("Failed to refresh aggregated candles", error);
      }
    }, 300);
  }, [applyCandles, fetchCandles, selectedSymbol, selectedInterval]);

  useEffect(() => {
    return () => {
      if (refreshTimeoutRef.current) {
        clearTimeout(refreshTimeoutRef.current);
        refreshTimeoutRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    const fetchSymbols = async () => {
      try {
        const data = await fetchGraphQL<{ symbols: GraphQLSymbol[] }>(
          `query Symbols {
            symbols {
              id
              is_active
            }
          }`
        );

        if (cancelled) {
          return;
        }

        const activeSymbols = data.symbols.filter((item) => item.is_active);
        setSymbolOptions(activeSymbols);
        if (!selectedSymbol && activeSymbols.length > 0) {
          setSelectedSymbol(activeSymbols[0].id);
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

    if (refreshTimeoutRef.current) {
      clearTimeout(refreshTimeoutRef.current);
      refreshTimeoutRef.current = null;
    }

    let cancelled = false;
    setIsStreaming(false);
    setErrorMessage(null);

    const load = async () => {
      try {
        const mapped = await fetchCandles(selectedSymbol, selectedInterval);
        if (cancelled) {
          return;
        }
        applyCandles(mapped);
        setIsStreaming(true);
      } catch (error) {
        console.error("Failed to fetch klines", error);
        if (!cancelled) {
          setCandles([]);
          setIsStreaming(false);
          setErrorMessage("분봉 데이터를 불러오지 못했습니다.");
        }
      }
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, [applyCandles, fetchCandles, selectedInterval, selectedSymbol]);

  useEffect(() => {
    if (!selectedSymbol) {
      setBinanceCandles([]);
      setBinanceStatus("idle");
      setBinanceErrorMessage(null);
      return;
    }

    const intervalCode = BINANCE_INTERVAL_MAP[
      selectedInterval as keyof typeof BINANCE_INTERVAL_MAP
    ] as BinanceInterval | undefined;

    if (!intervalCode) {
      setBinanceCandles([]);
      setBinanceStatus("error");
      setBinanceErrorMessage("지원하지 않는 간격입니다.");
      return;
    }

    const normalizedSymbol = normalizeBinanceSymbol(selectedSymbol);

    if (!normalizedSymbol) {
      setBinanceCandles([]);
      setBinanceStatus("error");
      setBinanceErrorMessage("바이낸스 심볼을 확인할 수 없습니다.");
      return;
    }

    let cancelled = false;
    let source: EventSource | null = null;

    const load = async () => {
      setBinanceStatus("connecting");
      setBinanceErrorMessage(null);

      try {
        const response = await fetch(
          `/api/binance/candles?symbol=${normalizedSymbol}&interval=${intervalCode}`
        );

        if (!response.ok) {
          throw new Error(
            `Failed to fetch Binance candles: ${response.status}`
          );
        }

        const payload = (await response.json()) as {
          candles: BinanceRestCandlePayload[];
        };

        if (cancelled) {
          return;
        }

        const mappedCandles = payload.candles
          .map((item) => mapBinanceRestCandle(item))
          .filter((value): value is Candle => value !== null)
          .slice(-MAX_CANDLES);

        setBinanceCandles(mappedCandles);
      } catch (error) {
        console.error("Failed to load Binance candles", error);
        if (!cancelled) {
          setBinanceStatus("error");
          setBinanceErrorMessage("바이낸스 데이터를 불러오지 못했습니다.");
        }
        return;
      }

      if (cancelled) {
        return;
      }

      source = new EventSource(
        `/api/binance/stream?symbol=${normalizedSymbol}&interval=${intervalCode}`
      );

      source.onopen = () => {
        if (!cancelled) {
          setBinanceStatus("connected");
        }
      };

      source.onmessage = (event) => {
        if (cancelled || !event.data) {
          return;
        }

        try {
          const parsed = JSON.parse(event.data) as {
            candle?: BinanceStreamCandlePayload;
          };

          if (!parsed.candle) {
            return;
          }

          const candle = mapBinanceStreamCandle(parsed.candle);
          if (!candle) {
            return;
          }

          setBinanceCandles((previous) => {
            if (previous.length === 0) {
              return [candle];
            }

            const existingIndex = previous.findIndex(
              (item) => item.openTime === candle.openTime
            );

            if (existingIndex !== -1) {
              const next = [...previous];
              next[existingIndex] = candle;
              return next;
            }

            const next = [...previous.slice(-(MAX_CANDLES - 1)), candle];
            return next.sort((a, b) => a.openTime - b.openTime);
          });
        } catch (error) {
          console.error("Failed to parse Binance stream payload", error);
        }
      };

      source.onerror = (event) => {
        console.error("Binance stream error", event);
        source?.close();
        if (!cancelled) {
          setBinanceStatus("error");
          setBinanceErrorMessage("바이낸스 실시간 연결이 끊어졌습니다.");
        }
      };
    };

    void load();

    return () => {
      cancelled = true;
      source?.close();
    };
  }, [selectedInterval, selectedSymbol]);

  useEffect(() => {
    if (!selectedSymbol) {
      return;
    }

    let active = true;
    const client = getWsClient();

    const dispose = client.subscribe(
      {
        query: `subscription KlineUpdated($symbol: String!, $interval: Float!) {
          klineUpdated(symbol: $symbol, interval: $interval) {
            symbol
            interval
            candleTime
            open
            high
            low
            close
            volume
          }
        }`,
        variables: {
          symbol: selectedSymbol,
          interval: selectedInterval,
        },
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

          const payload = result.data?.klineUpdated as
            | KlineSubModel
            | undefined;
          if (!payload) {
            return;
          }

          if (payload.interval !== selectedInterval) {
            return;
          }

          const candle = mapSubscriptionKlineToCandle(payload);
          if (!candle) {
            return;
          }

          if (selectedInterval === 1) {
            setCandles((previous) => {
              if (previous.length === 0) {
                return [candle];
              }

              const existingIndex = previous.findIndex(
                (item) => item.openTime === candle.openTime
              );

              if (existingIndex !== -1) {
                const nextCandles = [...previous];
                nextCandles[existingIndex] = candle;
                return nextCandles;
              }

              const nextCandles = [
                ...previous.slice(-(MAX_CANDLES - 1)),
                candle,
              ];
              return nextCandles.sort((a, b) => a.openTime - b.openTime);
            });
          } else {
            queueSilentRefresh();
          }

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
  }, [queueSilentRefresh, selectedInterval, selectedSymbol]);

  const handleSymbolChange = (event: ChangeEvent<HTMLSelectElement>) => {
    const nextSymbol = event.target.value;
    setSelectedSymbol(nextSymbol);
  };

  const handleIntervalModeChange = (event: ChangeEvent<HTMLSelectElement>) => {
    const { value } = event.target;
    if (value === "auto") {
      setIntervalMode("auto");
      setSelectedInterval(DEFAULT_INTERVAL_MINUTES);
    } else {
      const nextInterval = Number(value);
      setIntervalMode(nextInterval);
      setSelectedInterval(nextInterval);
    }
  };

  const handleZoomRangeChange = useCallback(
    (rangeMs: number) => {
      if (intervalMode !== "auto" || rangeMs <= 0 || candles.length === 0) {
        return;
      }

      const rangeMinutes = rangeMs / 60000;
      const nextInterval = pickIntervalForRange(rangeMinutes);

      if (nextInterval !== selectedInterval) {
        setSelectedInterval(nextInterval);
      }
    },
    [candles.length, intervalMode, selectedInterval]
  );

  const intervalSelectValue =
    intervalMode === "auto" ? "auto" : String(intervalMode);
  const graphQlStatusClass = isStreaming
    ? styles.connected
    : styles.disconnected;
  const graphQlStatusText = isStreaming ? "실시간 연결됨" : "연결 대기 중";
  const binanceStatusClass =
    binanceStatus === "connected"
      ? styles.connected
      : binanceStatus === "connecting"
      ? styles.pending
      : styles.disconnected;
  const binanceStatusText = (() => {
    switch (binanceStatus) {
      case "connected":
        return "실시간 연결됨";
      case "connecting":
        return "연결 중";
      case "error":
        return "연결 실패";
      default:
        return "대기 중";
    }
  })();

  return (
    <div className={styles.page}>
      <main className={styles.container}>
        <header className={styles.header}>
          <div>
            <h1 className={styles.title}>분봉 구독 샘플</h1>
            <p className={styles.subtitle}>
              GraphQL Subscription 흐름을 시각화한 목업입니다. API 엔드포인트는{" "}
              <strong>{apiUrl}</strong> 으로 설정되어 있습니다.
            </p>
          </div>
          <div className={styles.selectorGroup}>
            <label className={styles.selector}>
              <span>심볼 선택</span>
              <select
                value={selectedSymbol}
                onChange={handleSymbolChange}
                disabled={symbolOptions.length === 0}
              >
                {symbolOptions.map((symbol) => (
                  <option key={symbol.id} value={symbol.id}>
                    {symbol.id}
                  </option>
                ))}
              </select>
            </label>
            <label className={styles.selector}>
              <span>분봉</span>
              <select
                value={intervalSelectValue}
                onChange={handleIntervalModeChange}
              >
                <option value="auto">자동 (현재 {selectedInterval}분)</option>
                {INTERVAL_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {option}분
                  </option>
                ))}
              </select>
            </label>
          </div>
        </header>

        <section className={styles.chartCard}>
          <div className={styles.chartHeader}>
            <div>
              <h2>{selectedSymbol || "심볼을 선택하세요"}</h2>
              <p>{selectedInterval}분 봉 기준 실시간 데이터</p>
            </div>
            <div className={styles.chartMeta}>
              <div className={styles.statusRow}>
                <span
                  className={`${styles.statusDot} ${graphQlStatusClass}`}
                  aria-hidden
                />
                <span className={styles.statusText}>{graphQlStatusText}</span>
              </div>
              {latestCandle && (
                <div className={styles.priceSnapshot}>
                  <span className={styles.priceLabel}>현재가</span>
                  <strong className={styles.priceValue}>
                    {priceFormatter.format(latestCandle.close)}
                  </strong>
                  <span className={styles.timeValue}>
                    {timeFormatter.format(latestCandle.openTime)}
                  </span>
                </div>
              )}
            </div>
          </div>
          <div className={styles.chartWrapper}>
            <MinuteChart
              data={candles}
              symbol={selectedSymbol}
              intervalMinutes={selectedInterval}
              onZoomRangeChange={handleZoomRangeChange}
            />
          </div>
          {errorMessage && (
            <p className={styles.errorMessage}>{errorMessage}</p>
          )}
        </section>

        <section className={styles.chartCard}>
          <div className={styles.chartHeader}>
            <div>
              <h2>{binanceSymbol || "Binance 심볼"}</h2>
              <p>Binance {selectedInterval}분 봉 실시간 데이터</p>
            </div>
            <div className={styles.chartMeta}>
              <div className={styles.statusRow}>
                <span
                  className={`${styles.statusDot} ${binanceStatusClass}`}
                  aria-hidden
                />
                <span className={styles.statusText}>{binanceStatusText}</span>
              </div>
              {latestBinanceCandle && (
                <div className={styles.priceSnapshot}>
                  <span className={styles.priceLabel}>현재가</span>
                  <strong className={styles.priceValue}>
                    {priceFormatter.format(latestBinanceCandle.close)}
                  </strong>
                  <span className={styles.timeValue}>
                    {timeFormatter.format(latestBinanceCandle.openTime)}
                  </span>
                </div>
              )}
            </div>
          </div>
          <div className={styles.chartWrapper}>
            <MinuteChart
              data={binanceCandles}
              symbol={binanceSymbol}
              intervalMinutes={selectedInterval}
            />
          </div>
          {binanceErrorMessage && (
            <p className={styles.errorMessage}>{binanceErrorMessage}</p>
          )}
        </section>

        <section className={styles.comparisonCard}>
          <h3>데이터 차이 요약</h3>
          {differenceSummary ? (
            <ul className={styles.differenceList}>
              {differenceSummary.metrics.map((metric) => {
                const formatter =
                  metric.formatter === "price"
                    ? priceFormatter
                    : volumeFormatter;
                const formattedLocal = formatter.format(metric.localValue);
                const formattedBinance = formatter.format(metric.binanceValue);
                const formattedDiff = formatter.format(metric.diff);
                const formattedPercent =
                  metric.percent === null
                    ? null
                    : `${
                        metric.percent >= 0 ? "+" : ""
                      }${percentFormatter.format(Math.abs(metric.percent))}%`;

                return (
                  <li key={metric.label}>
                    <strong>{metric.label}</strong>
                    <span>
                      로컬 {formattedLocal} · Binance {formattedBinance}{" "}
                      <em>
                        ({metric.diff >= 0 ? "+" : ""}
                        {formattedDiff}
                        {formattedPercent && ` / ${formattedPercent}`})
                      </em>
                    </span>
                  </li>
                );
              })}
              <li>
                <strong>캔들 시각</strong>
                <span>
                  로컬 {timeFormatter.format(differenceSummary.localOpenTime)} /
                  Binance{" "}
                  {timeFormatter.format(differenceSummary.binanceOpenTime)}{" "}
                  {differenceSummary.timeDiffMinutes === 0
                    ? "(동일)"
                    : `(${Math.abs(differenceSummary.timeDiffMinutes).toFixed(
                        2
                      )}분 ${
                        differenceSummary.timeDiffMinutes > 0
                          ? "Binance가 앞섬"
                          : "Binance가 늦음"
                      })`}
                </span>
              </li>
              <li>
                <strong>상태</strong>
                <span>
                  GraphQL: {graphQlStatusText} · Binance: {binanceStatusText}
                </span>
              </li>
            </ul>
          ) : (
            <p className={styles.differencePlaceholder}>
              두 데이터 소스를 불러온 이후 차이점이 표시됩니다.
            </p>
          )}
          <p className={styles.comparisonFootnote}>
            상단 차트는 내부 GraphQL 데이터를, 하단 차트는 Binance 공식 API
            (binance-api-node)를 사용합니다.
          </p>
        </section>
      </main>
    </div>
  );
}
