import { describe, expect, it } from 'vitest';
import { extractToolDataRef } from './toolDataRef';

describe('extractToolDataRef（镜像后端 _tool_data_ref 启发式）', () => {
  it('从 generate_m2_bom_controlled 提取 BOM 行', () => {
    const ref = extractToolDataRef(
      'generate_m2_bom_controlled',
      {},
      {
        standard_bom: {
          bom_header: [{ bom_id: 'BOM-FG-01', parent_name: 'USB-C 1M' }],
          bom_lines: [
            { line_no: 10, component_item: 'CBL-01', qty_per: 1, uom: 'PCS' },
            { line_no: 20, component_item: 'PKG-01', qty_per: 1, uom: 'PCS' },
          ],
        },
      },
    );
    expect(ref).toEqual({
      kind: 'bom',
      title: 'BOM-FG-01',
      summary: '共 2 行 BOM 明细',
      rows: [
        { line_no: 10, component_item: 'CBL-01', qty_per: 1, uom: 'PCS' },
        { line_no: 20, component_item: 'PKG-01', qty_per: 1, uom: 'PCS' },
      ],
    });
  });

  it('从 run_bom_sop_workflow 的 result 包裹结构提取 BOM', () => {
    const ref = extractToolDataRef(
      'run_bom_sop_workflow',
      {},
      {
        result: {
          bom_generation: {
            standard_bom: { bom_header: [{ parent_name: 'XH041' }], bom_lines: [{ component_item: 'CBL-XH041', qty_per: 1 }] },
          },
          sop_generation: { document_no: 'SOP-XH041-001' },
        },
      },
    );
    expect(ref?.kind).toBe('bom');
    expect(ref?.title).toBe('XH041');
    expect(ref?.rows).toEqual([{ component_item: 'CBL-XH041', qty_per: 1 }]);
  });

  it('从 generate_m2_sop 提取 SOP 参数行', () => {
    const ref = extractToolDataRef(
      'generate_m2_sop',
      {},
      {
        status: 'demo_not_for_release',
        product_name: 'USB-C 1M',
        document_no: 'SOP-USB-C-001',
        model: {
          normalization: {
            shape_normalization: [
              { id: 'OP01', name: '来料核对' },
              { id: 'OP02', name: '贴标签' },
            ],
          },
        },
      },
    );
    expect(ref).toEqual({
      kind: 'sop',
      title: 'SOP-USB-C-001',
      summary: '共 2 项 SOP 参数',
      rows: [
        { id: 'OP01', name: '来料核对' },
        { id: 'OP02', name: '贴标签' },
      ],
    });
  });

  it('从 get_m1_document 提取工程图文件引用', () => {
    const ref = extractToolDataRef(
      'get_m1_document',
      { task_id: 'task-dwg-1' },
      { source: { original_filename: '外壳图纸.png' }, document_type: 'technical_document' },
    );
    expect(ref).toEqual({
      kind: 'drawing',
      title: '外壳图纸.png',
      summary: '工程图纸原文件预览',
      file_url: '/api/m1/files/task-dwg-1',
    });
  });

  it('从 search_m1_documents 数组结果提取第一份图纸', () => {
    const ref = extractToolDataRef(
      'search_m1_documents',
      {},
      [{ task_id: 'task-dwg-2', filename: '装配图.pdf', document_type: 'technical_document' }],
    );
    expect(ref?.kind).toBe('drawing');
    expect(ref?.file_url).toBe('/api/m1/files/task-dwg-2');
  });

  it('未识别到结构化数据时返回 undefined', () => {
    expect(extractToolDataRef('safe_lookup', {}, { items: [{ id: 'A-1' }] })).toBeUndefined();
    expect(extractToolDataRef('generate_m2_bom_controlled', {}, { status: 'failed' })).toBeUndefined();
    expect(extractToolDataRef('get_m1_document', {}, { source: {} })).toBeUndefined();
    expect(extractToolDataRef('generate_m2_sop', {}, { status: 'failed' })).toBeUndefined();
  });

  it('行数与单元格长度截断', () => {
    const rows = Array.from({ length: 150 }, (_, index) => ({ component_item: `ITEM-${index}`, note: 'x'.repeat(500) }));
    const ref = extractToolDataRef('generate_m2_bom_controlled', {}, { standard_bom: { bom_lines: rows } });
    expect(ref?.rows).toHaveLength(100);
    expect(ref?.rows?.[0]?.note).toHaveLength(121); // 120 截断 + "…"
    expect(ref?.summary).toContain('预览前 100 行');
  });
});
