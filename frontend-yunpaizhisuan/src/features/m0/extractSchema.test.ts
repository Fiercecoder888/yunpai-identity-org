import { describe, expect, it } from 'vitest';
import {
  extractForDomain,
  extractGeneric,
  extractOrder,
  extractPo,
  extractPollIntervalMs,
  extractRows,
  extractSop,
  extractSpecification,
  normalizeExtractStatus,
  parseExtractContent,
  pickField,
  summarizeExtraction,
} from './extractSchema';

describe('normalizeExtractStatus', () => {
  it('maps empty, queued, extracting, done, failed, review, skipped', () => {
    expect(normalizeExtractStatus('').kind).toBe('empty');
    expect(normalizeExtractStatus('created').kind).toBe('queued');
    expect(normalizeExtractStatus('queued').kind).toBe('queued');
    expect(normalizeExtractStatus('extracting').kind).toBe('extracting');
    expect(normalizeExtractStatus('processing').kind).toBe('extracting');
    expect(normalizeExtractStatus('done').kind).toBe('done');
    expect(normalizeExtractStatus('completed').kind).toBe('done');
    expect(normalizeExtractStatus('agent_complete').kind).toBe('done');
    expect(normalizeExtractStatus('failed:RuntimeError').kind).toBe('failed');
    expect(normalizeExtractStatus('failed:RuntimeError').reason).toBe('RuntimeError');
    expect(normalizeExtractStatus('needs_review').kind).toBe('needs_review');
    expect(normalizeExtractStatus('agent_needs_review').kind).toBe('needs_review');
    expect(normalizeExtractStatus('skipped').kind).toBe('skipped');
    expect(normalizeExtractStatus('weird-status').kind).toBe('unknown');
  });
});

describe('parseExtractContent / pickField / extractRows', () => {
  it('parses JSON and falls back to text', () => {
    expect(parseExtractContent('{"a":1}')).toEqual({ a: 1 });
    expect(parseExtractContent('plain text')).toBe('plain text');
    expect(parseExtractContent('')).toBeNull();
    expect(parseExtractContent(null)).toBeNull();
  });

  it('picks nested fields with English or Chinese keys', () => {
    const source = { header: { '订单号': 'SO-1' }, detail: { due_date: '2026-09-01' } };
    expect(pickField(source, ['order_no', '订单号'])).toBe('SO-1');
    expect(pickField(source, ['due_date', '交期'])).toBe('2026-09-01');
  });

  it('extracts rows from arrays and wrapped bags', () => {
    expect(extractRows([{ a: 1 }, { b: 2 }])).toHaveLength(2);
    expect(extractRows({ items: [{ a: 1 }] })).toHaveLength(1);
    expect(extractRows({ rows: [{ a: 1 }] })).toHaveLength(1);
    expect(extractRows({ data: [{ a: 1 }] })).toHaveLength(1);
    expect(extractRows({ notRows: [1] })).toEqual([]);
    expect(extractRows('text')).toEqual([]);
  });
});

describe('extractForDomain', () => {
  it('extracts order fields from Chinese keys', () => {
    const result = extractForDomain('order', JSON.stringify({ 订单号: 'CAND-088', 产品: 'HDMI 线', 数量: 5000, 交期: '2026-09-20', 客户: 'CANDELIGHT' }));
    expect(result.kind).toBe('order');
    if (result.kind === 'order') {
      expect(result.data).toEqual({ orderNo: 'CAND-088', product: 'HDMI 线', qty: '5000', dueDate: '2026-09-20', customer: 'CANDELIGHT' });
    }
  });

  it('extracts order fields from English keys', () => {
    expect(extractOrder({ order_no: 'SO-1', product_name: 'FG-1', qty: 2, due_date: '2026-08-30', customer: 'Acme' })).toEqual({
      orderNo: 'SO-1',
      product: 'FG-1',
      qty: '2',
      dueDate: '2026-08-30',
      customer: 'Acme',
    });
  });

  it('extracts order fields from the T1.0 header/lines schema', () => {
    const result = extractForDomain(
      'order',
      JSON.stringify({
        source: '订单.pdf',
        document_type: 'order',
        header: { doc_no: 'CAND-088', customer: 'CANDELIGHT', due_date: '2026-09-20' },
        lines: [{ model: 'HDMI 线', qty: 5000 }],
        extractor: 'm0-rules-v1',
        status: 'ok',
      }),
    );
    expect(result.kind).toBe('order');
    if (result.kind === 'order') {
      expect(result.data.orderNo).toBe('CAND-088');
      expect(result.data.customer).toBe('CANDELIGHT');
      expect(result.data.dueDate).toBe('2026-09-20');
      expect(result.data.product).toBe('HDMI 线');
      expect(result.data.qty).toBe('5000');
    }
  });

  it('extracts BOM model and material rows', () => {
    const result = extractForDomain(
      'bom',
      JSON.stringify({ model: '成品A-2080', items: [{ material_code: '110200M', material_name: '锌合金外壳', qty: 1, loss_rate: 0.05 }] }),
    );
    expect(result.kind).toBe('bom');
    if (result.kind === 'bom') {
      expect(result.data.model).toBe('成品A-2080');
      expect(result.data.rows[0]).toEqual({ materialCode: '110200M', materialName: '锌合金外壳', qty: '1', lossRate: '0.05' });
    }
  });

  it('extracts drawing fields', () => {
    const result = extractForDomain('drawing', JSON.stringify({ 图纸编号: 'ABC-123', 标题: 'HDMI 图纸', 图纸类型: '3D' }));
    expect(result.kind).toBe('drawing');
    if (result.kind === 'drawing') {
      expect(result.data.drawingNo).toBe('ABC-123');
      expect(result.data.title).toBe('HDMI 图纸');
      expect(result.data.drawingType).toBe('3D');
    }
  });

  it('extracts drawing fields from the T1.0 header schema with part_no fallback title', () => {
    const result = extractForDomain(
      'drawing',
      JSON.stringify({ header: { drawing_no: 'ABC-123', part_no: 'PN-001' }, lines: [] }),
    );
    expect(result.kind).toBe('drawing');
    if (result.kind === 'drawing') {
      expect(result.data.drawingNo).toBe('ABC-123');
      expect(result.data.partNo).toBe('PN-001');
      expect(result.data.title).toBe('PN-001');
    }
  });

  it('extracts SOP rows', () => {
    const rows = extractSop([{ 工序: '组装', 工步: '1.1', 作业内容: '穿线', 参数: '5N' }]);
    expect(rows[0]).toEqual({ process: '组装', step: '1.1', content: '穿线', params: '5N' });
  });

  it('extracts specification params', () => {
    const rows = extractSpecification({ params: [{ 参数名称: '线材长度', 参数值: '1.5', 单位: 'M' }] });
    expect(rows[0]).toEqual({ name: '线材长度', value: '1.5', unit: 'M' });
  });

  it('extracts specification header fields from the T1.0 schema', () => {
    const rows = extractSpecification({
      header: { product_spec: 'HDMI 线材 1.5M', core_count: '4C', conductor: '22AWG' },
      lines: [],
    });
    expect(rows).toContainEqual({ name: '品名规格', value: 'HDMI 线材 1.5M', unit: '' });
    expect(rows).toContainEqual({ name: '芯线数', value: '4C', unit: '' });
  });

  it('extracts PO header and rows', () => {
    const po = extractPo({ po_no: 'PO-1', supplier: '华东供应商', items: [{ material: '锌合金外壳', qty: 2000, due_date: '2026-09-01' }] });
    expect(po.poNo).toBe('PO-1');
    expect(po.supplier).toBe('华东供应商');
    expect(po.rows[0]).toEqual({ material: '锌合金外壳', qty: '2000', dueDate: '2026-09-01' });
  });

  it('extracts PO header and model rows from the T1.0 schema', () => {
    const po = extractPo({
      header: { doc_no: 'PO-20260801', supplier: '华东供应商' },
      lines: [{ model: '锌合金外壳', qty: 2000, due_date: '2026-09-01' }],
    });
    expect(po.poNo).toBe('PO-20260801');
    expect(po.supplier).toBe('华东供应商');
    expect(po.rows[0]).toEqual({ material: '锌合金外壳', qty: '2000', dueDate: '2026-09-01' });
  });

  it('extracts BOM material codes from T1.0 material/raw lines', () => {
    const result = extractForDomain(
      'bom',
      JSON.stringify({ header: {}, lines: [{ material: '110200M', raw: '110200M 锌合金外壳' }] }),
    );
    expect(result.kind).toBe('bom');
    if (result.kind === 'bom') {
      expect(result.data.rows[0]?.materialCode).toBe('110200M');
    }
  });

  it('falls back to generic fields for unknown domains', () => {
    const fields = extractGeneric({ a: 1, nested: { b: 'x' }, list: [{ c: 'y' }] });
    expect(fields).toContainEqual({ key: 'a', value: '1' });
    expect(fields).toContainEqual({ key: 'nested.b', value: 'x' });
    expect(fields).toContainEqual({ key: 'list[0].c', value: 'y' });
  });

  it('returns text kind for non-JSON content and empty kind for blanks', () => {
    expect(extractForDomain('drawing', '尺寸:22.50±0.20 材质:锌合金').kind).toBe('text');
    expect(extractForDomain('drawing', '').kind).toBe('empty');
  });
});

describe('summarizeExtraction / extractPollIntervalMs', () => {
  it('summarizes statuses into aggregate kind', () => {
    expect(summarizeExtraction([{ extract_status: 'done' }, { extract_status: 'done' }]).kind).toBe('done');
    expect(summarizeExtraction([{ extract_status: 'done' }, { extract_status: 'failed:Timeout' }]).kind).toBe('failed');
    expect(summarizeExtraction([{ extract_status: 'extracting' }, { extract_status: 'done' }]).kind).toBe('active');
    expect(summarizeExtraction([{ extract_status: 'needs_review' }]).kind).toBe('review');
  });

  it('polls while any document is active and stops when settled', () => {
    expect(extractPollIntervalMs([{ extract_status: 'extracting' }])).toBe(2000);
    expect(extractPollIntervalMs([{ extract_status: '' }])).toBe(2000);
    expect(extractPollIntervalMs([{ extract_status: 'done' }, { extract_status: 'failed:x' }])).toBe(false);
  });
});
