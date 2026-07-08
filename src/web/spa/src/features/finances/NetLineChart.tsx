import React, { useEffect, useRef } from "react";
import { createChart, AreaSeries, type IChartApi } from "lightweight-charts";

function themeColor(varName: string, fallback: string): string {
  const raw = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
  return raw ? `rgb(${raw})` : fallback;
}

/** Area chart of {date, value} points (cash flow / forecast). */
const NetLineChart: React.FC<{ points: { date: string; value: number }[] }> = ({ points }) => {
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
    const series = chart.addSeries(AreaSeries, {
      lineColor: "#10b981",
      topColor: "rgba(16, 185, 129, 0.3)",
      bottomColor: "rgba(16, 185, 129, 0.0)",
      lineWidth: 2,
    });
    series.setData(points.map((p) => ({ time: p.date, value: p.value })));
    chart.timeScale().fitContent();
    chartRef.current = chart;
    return () => {
      chart.remove();
      chartRef.current = null;
    };
  }, [points]);

  return <div ref={containerRef} className="h-64 w-full" />;
};

export default NetLineChart;
