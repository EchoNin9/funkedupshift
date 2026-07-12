import React, { useEffect, useRef } from "react";
import { createChart, CandlestickSeries, type IChartApi, type UTCTimestamp } from "lightweight-charts";

export interface Candle {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

function themeColor(varName: string, fallback: string): string {
  const raw = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
  return raw ? `rgb(${raw})` : fallback;
}

const CandleChart: React.FC<{ candles: Candle[] }> = ({ candles }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const chart = createChart(el, {
      autoSize: true,
      layout: {
        background: { color: "transparent" },
        textColor: themeColor("--color-text-secondary", "#9ca3af"),
        attributionLogo: false,
      },
      grid: {
        vertLines: { color: themeColor("--color-border-subtle", "#2a2138") },
        horzLines: { color: themeColor("--color-border-subtle", "#2a2138") },
      },
      timeScale: { borderVisible: false },
      rightPriceScale: { borderVisible: false },
    });
    // Up/down pair validated for CVD separation + dark-surface contrast (dataviz)
    const series = chart.addSeries(CandlestickSeries, {
      upColor: "#10b981",
      downColor: "#ef4444",
      wickUpColor: "#10b981",
      wickDownColor: "#ef4444",
      borderVisible: false,
    });
    series.setData(
      candles.map((c) => ({ time: c.t as UTCTimestamp, open: c.o, high: c.h, low: c.l, close: c.c }))
    );
    chart.timeScale().fitContent();
    chartRef.current = chart;
    return () => {
      chart.remove();
      chartRef.current = null;
    };
  }, [candles]);

  return <div ref={containerRef} className="h-72 w-full" />;
};

export default CandleChart;
