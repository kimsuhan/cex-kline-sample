import { Chart, registerables } from "chart.js";
import { CandlestickController, CandlestickElement, OhlcController, OhlcElement } from "chartjs-chart-financial";
import "chartjs-adapter-date-fns";

let registered = false;
let registrationPromise: Promise<void> | null = null;

export function ensureFinancialChartRegistered(): Promise<void> {
  if (registered) {
    return Promise.resolve();
  }

  if (registrationPromise) {
    return registrationPromise;
  }

  registrationPromise = (async () => {
    if (typeof window === "undefined") {
      return;
    }

    const { default: zoomPlugin } = await import("chartjs-plugin-zoom");

    Chart.register(
      ...registerables,
      CandlestickController,
      CandlestickElement,
      OhlcController,
      OhlcElement,
      zoomPlugin
    );

    registered = true;
  })();

  return registrationPromise;
}
