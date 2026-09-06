/**
 * 模拟工位目录（测试用）。
 *
 * 来源：PMC 排程工序（orchestrator graph.py 的 OP-10 裁线/WC-1 … OP-40 测试 等）
 * 与 SOP 工艺步骤（押出/绞线/注塑/组装…）。组长页「自由填人进入模拟工位」时，
 * 工位下拉从本目录选择（也可自由输入新工位名）。
 *
 * operation_id 对齐 schedule_operations / m0_master_piece_rate 的 operation_id 口径，
 * 保证报工与计件单价按同一工位匹配。
 */

export type MockStation = {
  /** 工序 ID（与排程/单价表口径一致，如 OP-10）。 */
  operationId: string;
  /** 工序名（SOP 步骤名，如 裁线）。 */
  operationName: string;
  /** 工位名（如 裁线机 01）。 */
  station: string;
  /** 车间/线体。 */
  line: string;
};

/** 模拟工位目录（PMC/SOP 常见工序）。 */
export const MOCK_STATIONS: MockStation[] = [
  { operationId: 'OP-10', operationName: '裁线', station: '裁线机 01', line: '一车间' },
  { operationId: 'OP-10', operationName: '裁线', station: '裁线机 02', line: '二车间' },
  { operationId: 'OP-10', operationName: '裁线', station: '裁线机 03', line: '四车间' },
  { operationId: 'OP-20', operationName: '焊接', station: '焊接机 01', line: '一车间' },
  { operationId: 'OP-20', operationName: '焊接', station: '焊接机 02', line: '三车间' },
  { operationId: 'OP-30', operationName: '组装', station: '组装线 03', line: '一车间' },
  { operationId: 'OP-30', operationName: '组装', station: '组装线 04', line: '一车间' },
  { operationId: 'OP-30', operationName: '组装', station: '组装线 05', line: '三车间' },
  { operationId: 'OP-30', operationName: '组装', station: '组装线 06', line: '四车间' },
  { operationId: 'OP-40', operationName: '测试', station: '测试台 01', line: '一车间' },
  { operationId: 'OP-40', operationName: '测试', station: '测试台 02', line: '三车间' },
  { operationId: 'OP-40', operationName: '测试', station: '测试台 03', line: '四车间' },
  { operationId: 'OP-50', operationName: '押出', station: '押出机 01', line: '一车间' },
  { operationId: 'OP-50', operationName: '押出', station: '押出机 02', line: '一车间' },
  { operationId: 'OP-50', operationName: '押出', station: '押出机 03', line: '三车间' },
  { operationId: 'OP-60', operationName: '绞线', station: '绞线机 01', line: '一车间' },
  { operationId: 'OP-60', operationName: '绞线', station: '绞线机 02', line: '一车间' },
  { operationId: 'OP-60', operationName: '绞线', station: '绞线机 03', line: '二车间' },
  { operationId: 'OP-70', operationName: '注塑', station: '注塑机 02', line: '一车间' },
  { operationId: 'OP-70', operationName: '注塑', station: '注塑机 03', line: '一车间' },
  { operationId: 'OP-70', operationName: '注塑', station: '注塑机 04', line: '三车间' },
  { operationId: 'OP-80', operationName: '包装', station: '包装线 01', line: '二车间' },
  { operationId: 'OP-80', operationName: '包装', station: '包装线 02', line: '二车间' },
  { operationId: 'OP-80', operationName: '包装', station: '包装线 03', line: '三车间' },
  { operationId: 'OP-90', operationName: '冲压', station: '冲压机 01', line: '二车间' },
  { operationId: 'OP-90', operationName: '冲压', station: '冲压机 02', line: '三车间' },
  { operationId: 'OP-100', operationName: '端子压接', station: '端子压接机 01', line: '二车间' },
  { operationId: 'OP-100', operationName: '端子压接', station: '端子压接机 02', line: '三车间' },
  { operationId: 'OP-110', operationName: '铜带绕包', station: '铜带绕包机 01', line: '二车间' },
  { operationId: 'OP-110', operationName: '铜带绕包', station: '铜带绕包机 02', line: '四车间' },
];

/** 工位展示标签：OP-50 押出 · 押出机 01。 */
export const stationDisplayLabel = (station: MockStation): string =>
  `${station.operationId} ${station.operationName} · ${station.station}（${station.line}）`;
