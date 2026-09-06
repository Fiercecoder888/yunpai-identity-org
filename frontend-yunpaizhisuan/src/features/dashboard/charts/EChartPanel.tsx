import type { EChartsCoreOption } from 'echarts/core';
import { useEffect, useRef } from 'react';
import { echarts, registerECharts } from './echartsRegistry';

export type EChartPanelProps = {
  option: EChartsCoreOption;
  height?: number;
  ariaLabel?: string;
  loading?: boolean;
  empty?: boolean;
};

const isCanvasSupported = () => {
  if (typeof document === 'undefined') {
    return false;
  }
  try {
    const canvas = document.createElement('canvas');
    return Boolean(canvas.getContext && canvas.getContext('2d'));
  } catch {
    return false;
  }
};

export function EChartPanel({ option, height = 260, ariaLabel, loading = false, empty = false }: EChartPanelProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<ReturnType<typeof echarts.init> | null>(null);

  useEffect(() => {
    registerECharts();
    const element = containerRef.current;
    if (!element || !isCanvasSupported()) {
      return;
    }
    let chart: ReturnType<typeof echarts.init> | null = null;
    try {
      chart = echarts.init(element, undefined, { renderer: 'canvas' });
      chartRef.current = chart;
    } catch {
      chartRef.current = null;
    }
    const onResize = () => {
      try {
        chart?.resize();
      } catch {
        // jsdom 等无真实 canvas 环境忽略
      }
    };
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(onResize) : null;
    observer?.observe(element);
    return () => {
      observer?.disconnect();
      try {
        chart?.dispose();
      } catch {
        // 渲染上下文不可用时 dispose 可能抛错，忽略
      }
      chartRef.current = null;
    };
  }, []);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) {
      return;
    }
    try {
      if (loading) {
        chart.showLoading('default', { text: '加载中...' });
        return;
      }
      chart.hideLoading();
      if (empty) {
        chart.clear();
        return;
      }
      chart.setOption(option, { notMerge: true });
    } catch {
      // 渲染上下文不可用时忽略，展示空容器
    }
  }, [option, loading, empty]);

  return (
    <div
      ref={containerRef}
      role="img"
      aria-label={ariaLabel}
      className="yp-echart-panel"
      style={{ width: '100%', height }}
    />
  );
}
