import type { EChartsCoreOption } from 'echarts/core';
import type { M3MaterialReadinessLine } from '../../../../schemas/m3';

const STATUS_ORDER = ['ready', 'covered_by_stock_or_open_po', 'allocated_by_fifo', 'shortage', 'blocked'] as const;

const STATUS_LABELS: Record<(typeof STATUS_ORDER)[number], string> = {
  ready: '齐套',
  covered_by_stock_or_open_po: '在库/在途覆盖',
  allocated_by_fifo: 'FIFO 分配',
  shortage: '缺料',
  blocked: '阻断',
};

export type ShortageHeatmapCell = {
  materialCode: string;
  status: string;
  value: number;
};

/**
 * 缺料热力图（降级：material × status）。
 * 每个物料按 line_status 聚合建议采购量；后端多维缺料评分未交付时
 * 用可用口径（shortage_qty / suggest_purchase_qty）作为矩阵值。
 */
export const buildShortageHeatmapOption = (lines: M3MaterialReadinessLine[]): EChartsCoreOption => {
  const materials = Array.from(new Set(lines.map((line) => line.material_code))).slice(0, 40);
  const statuses = STATUS_ORDER.filter((status) => lines.some((line) => line.line_status === status));
  const data: ShortageHeatmapCell[] = materials.flatMap((materialCode) =>
    statuses.map((status) => {
      const line = lines.find(
        (candidate) => candidate.material_code === materialCode && candidate.line_status === status,
      );
      const value = line
        ? status === 'shortage'
          ? line.shortage_qty + line.suggest_purchase_qty
          : line.available_qty + line.open_po_qty
        : 0;
      return { materialCode, status, value };
    }),
  );
  return {
    title: { text: '缺料热力（物料 × 状态）', left: 'center', textStyle: { fontSize: 12 } },
    tooltip: {
      position: 'top',
      formatter: (params: unknown) => {
        const cell = params as { data?: { value?: [number, number, number] } };
        const value = cell.data?.value;
        const materialIndex = value?.[0];
        const statusIndex = value?.[1];
        const material = materialIndex !== undefined ? materials[materialIndex] : undefined;
        const status = statusIndex !== undefined ? statuses[statusIndex] : undefined;
        const statusLabel = status ? (STATUS_LABELS[status] ?? status) : '';
        return `${material ?? ''} · ${statusLabel}<br/>数量：${value?.[2] ?? 0}`;
      },
    },
    grid: { left: 72, right: 24, top: 44, bottom: 96 },
    xAxis: { type: 'category', data: statuses.map((status) => STATUS_LABELS[status]), splitArea: { show: true } },
    yAxis: { type: 'category', data: materials, splitArea: { show: true } },
    visualMap: {
      min: 0,
      max: Math.max(1, ...data.map((cell) => cell.value)),
      calculable: true,
      orient: 'horizontal',
      left: 'center',
      bottom: 8,
    },
    series: [
      {
        type: 'heatmap',
        data: data.map((cell) => [statuses.indexOf(cell.status as (typeof STATUS_ORDER)[number]), materials.indexOf(cell.materialCode), cell.value]),
        label: { show: true },
      },
    ],
  };
};
