/**
 * 计件工资 API：m5 piece-wage 报表查询 + m0 计件单价主数据。
 * 网关路径 /m5/piece-wage/* 与 /m0/import/master/m0_master_piece_rate。
 */

import { requestJson } from './httpClient';
import { withQuery } from './apiGateway';
import { unwrapEnvelope } from './apiResponse';

export type PieceWageLine = {
  worker_id: string;
  worker_name: string;
  order_id: string;
  operation_id: string;
  station: string;
  qty_reported: number;
  qty_scrap: number;
  unit_price: number;
  uom: string;
  amount: number;
  has_rate: boolean;
};

export type PieceWageSummaryWorker = {
  worker_id: string;
  worker_name: string;
  amount: number;
  lines: number;
  orders: string[];
};

export type PieceWageSummaryOrder = {
  order_id: string;
  amount: number;
  lines: number;
  workers: string[];
};

export type PieceWageSummaryStation = {
  operation_id: string;
  station: string;
  amount: number;
  lines: number;
  orders: string[];
  workers: string[];
};

export type PieceWageMissingRate = {
  worker_id: string;
  order_id: string;
  operation_id: string;
  station: string;
  qty_reported: number;
};

export type PieceWageDaily = {
  shift_date: string | null;
  total: number;
  line_count: number;
  lines: PieceWageLine[];
  summary_by_worker: PieceWageSummaryWorker[];
  summary_by_order: PieceWageSummaryOrder[];
  summary_by_station: PieceWageSummaryStation[];
  missing_rate: PieceWageMissingRate[];
};

export type PieceRate = {
  order_id: string;
  product_id: string;
  product_name: string;
  operation_id: string;
  station: string;
  unit_price: number;
  uom: string;
};

export type PieceRateQuery = {
  shift_date?: string;
  worker_id?: string;
  team_id?: string;
  order_id?: string;
};

/** 每日计件工资报表（m5）。 */
export async function fetchPieceWageDaily(query: PieceRateQuery = {}): Promise<PieceWageDaily> {
  const response = await requestJson<unknown>(withQuery('/m5/piece-wage/daily', query));
  const data = unwrapEnvelope<unknown>(response);
  return data as PieceWageDaily;
}

/** 查询 m0 计件单价主数据。 */
export async function fetchPieceRates(query: { order_id?: string; operation_id?: string } = {}): Promise<PieceRate[]> {
  const response = await requestJson<unknown>(withQuery('/m5/piece-wage/rates', query));
  const data = unwrapEnvelope<unknown>(response) as { items?: PieceRate[] };
  return data?.items ?? [];
}
