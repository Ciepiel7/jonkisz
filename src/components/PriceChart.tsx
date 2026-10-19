"use client";

import { useEffect, useMemo, useRef } from "react";
import {
  CandlestickSeries,
  ColorType,
  createChart,
  HistogramSeries,
  type IChartApi,
  type ISeriesApi,
  type CandlestickData,
  type HistogramData,
  type Time,
} from "lightweight-charts";
import type { Candle } from "@/engine/types";

/** Agregacja względem świecy bazowej 5s: 5s / 15s / 1m */
export type ChartTimeframe = 1 | 3 | 12;

function aggregateCandles(candles: Candle[], mult: ChartTimeframe): Candle[] {
  if (mult === 1) return candles;
  const basePeriod = 5;
  const bucketSec = basePeriod * mult;
  const map = new Map<number, Candle>();
  for (const c of candles) {
    const t = Math.floor(c.time / bucketSec) * bucketSec;
    const prev = map.get(t);
    if (!prev) {
      map.set(t, { ...c, time: t });
    } else {
      prev.high = Math.max(prev.high, c.high);
      prev.low = Math.min(prev.low, c.low);
      prev.close = c.close;
      prev.volume += c.volume;
    }
  }
  return [...map.values()].sort((a, b) => a.time - b.time);
}

function toCandleData(candles: Candle[]): CandlestickData<Time>[] {
  const byTime = new Map<number, CandlestickData<Time>>();
  for (const c of candles) {
    if (!(c.high >= c.low) || !(c.open > 0) || !(c.close > 0)) continue;
    byTime.set(c.time, {
      time: c.time as Time,
      open: c.open,
      high: Math.max(c.high, c.open, c.close),
      low: Math.min(c.low, c.open, c.close),
      close: c.close,
    });
  }
  return [...byTime.values()].sort((a, b) => (a.time as number) - (b.time as number));
}

function toVolumeData(candles: Candle[]): HistogramData<Time>[] {
  return candles
    .filter((c) => c.open > 0 && c.close > 0)
    .map((c) => ({
      time: c.time as Time,
      value: c.volume,
      color: c.close >= c.open ? "rgba(14, 203, 129, 0.45)" : "rgba(246, 70, 93, 0.45)",
    }));
}

export function PriceChart({
  candles,
  timeframe = 1,
}: {
  candles: Candle[];
  timeframe?: ChartTimeframe;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volumeRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const lastLen = useRef(0);

  const aggregated = useMemo(
    () => aggregateCandles(candles, timeframe),
    [candles, timeframe],
  );

  useEffect(() => {
    if (!containerRef.current) return;
    const chart = createChart(containerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: "#000000" },
        textColor: "#6a6a6a",
        fontFamily: "JetBrains Mono, ui-monospace, monospace",
        fontSize: 11,
      },
      grid: {
        vertLines: { color: "#121212" },
        horzLines: { color: "#121212" },
      },
      rightPriceScale: {
        borderColor: "#1c1c1c",
        scaleMargins: { top: 0.04, bottom: 0.22 },
      },
      timeScale: {
        borderColor: "#1c1c1c",
        timeVisible: true,
        secondsVisible: true,
        barSpacing: 8,
        minBarSpacing: 4,
        rightOffset: 6,
      },
      crosshair: {
        mode: 0,
        vertLine: { color: "#333", labelBackgroundColor: "#1a1a1a" },
        horzLine: { color: "#333", labelBackgroundColor: "#1a1a1a" },
      },
    });
    const series = chart.addSeries(CandlestickSeries, {
      upColor: "#0ecb81",
      downColor: "#f6465d",
      borderUpColor: "#0ecb81",
      borderDownColor: "#f6465d",
      wickUpColor: "#0ecb81",
      wickDownColor: "#f6465d",
    });
    const volume = chart.addSeries(HistogramSeries, {
      priceFormat: { type: "volume" },
      priceScaleId: "vol",
    });
    chart.priceScale("vol").applyOptions({
      scaleMargins: { top: 0.82, bottom: 0 },
    });
    chartRef.current = chart;
    seriesRef.current = series;
    volumeRef.current = volume;
    lastLen.current = 0;

    const ro = new ResizeObserver(() => {
      if (!containerRef.current) return;
      chart.applyOptions({
        width: containerRef.current.clientWidth,
        height: containerRef.current.clientHeight,
      });
    });
    ro.observe(containerRef.current);

    return () => {
      ro.disconnect();
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
      volumeRef.current = null;
    };
  }, []);

  useEffect(() => {
    lastLen.current = 0;
  }, [timeframe]);

  useEffect(() => {
    if (!seriesRef.current || !aggregated.length) return;
    const data = toCandleData(aggregated);
    const vols = toVolumeData(aggregated);
    if (!data.length) return;

    const series = seriesRef.current;
    const prevLen = lastLen.current;
    const last = data[data.length - 1]!;

    if (prevLen > 0 && data.length >= prevLen && data.length - prevLen <= 2) {
      try {
        series.update(last);
        if (data.length > prevLen && data.length >= 2) {
          series.update(data[data.length - 2]!);
        }
        const lastVol = vols[vols.length - 1];
        if (lastVol) volumeRef.current?.update(lastVol);
      } catch {
        series.setData(data);
        volumeRef.current?.setData(vols);
      }
    } else {
      series.setData(data);
      volumeRef.current?.setData(vols);
    }
    lastLen.current = data.length;

    const from = Math.max(0, data.length - 48);
    chartRef.current?.timeScale().setVisibleLogicalRange({
      from,
      to: data.length + 4,
    });
  }, [aggregated]);

  return <div ref={containerRef} className="h-full w-full" />;
}
