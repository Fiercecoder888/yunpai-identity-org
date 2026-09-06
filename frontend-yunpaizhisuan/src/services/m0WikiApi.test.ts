import { describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '../mocks/server';
import {
  getM0WikiBomDiff,
  getM0WikiBomLines,
  getM0WikiEquipment,
  getM0WikiMaterial,
  getM0WikiProduct,
  searchM0Wiki,
} from './m0WikiApi';

const envelope = (data: unknown) => ({ success: true, data, errors: [] });

const productWiki = {
  product: { entity_id: 'ent_p', business_key: 'V-H301W', label: '唯格 HDMI', status: 'active' },
  indexes: {
    orders: [],
    approval_specifications: [],
    boms: [{ entity_id: 'ent_b', business_key: 'BOM-VH301W', version_id: 'R03', status: 'active' }],
    sops: [],
    engineering_drawings: [],
  },
  families: [],
  same_family_products: [],
  routes: [],
  graph: { nodes: [], edges: [] },
  history: [{ version_id: 'R03', recorded_from: '2026-08-15T00:00:00Z', recorded_to: null, status: 'active' }],
  as_of: null,
  summary: { orders: 0, boms: 1 },
};

describe('m0WikiApi Wiki 只读知识视图', () => {
  it('混合检索返回结果列表', async () => {
    server.use(
      http.post('/api/m0/search', async ({ request }) => {
        const body = (await request.json()) as { query: string; limit: number };
        expect(body.query).toBe('V-H301W');
        return HttpResponse.json(
          envelope({
            query: 'V-H301W',
            results: [{ entity_id: 'ent_p', entity_type: 'product', business_key: 'V-H301W', score: 100 }],
            summary: { total: 1 },
          }),
        );
      }),
    );
    const results = await searchM0Wiki('V-H301W');
    expect(results).toHaveLength(1);
    expect(results[0]!.business_key).toBe('V-H301W');
  });

  it('加载产品 Wiki 页并解包信封', async () => {
    server.use(
      http.get('/api/m0/wiki/products/V-H301W', () => HttpResponse.json(envelope(productWiki))),
    );
    const page = await getM0WikiProduct('V-H301W');
    expect(page.product.business_key).toBe('V-H301W');
    expect(page.indexes.boms?.[0]?.version_id).toBe('R03');
    expect(page.history).toHaveLength(1);
  });

  it('as_of 参数透传到产品 Wiki 查询', async () => {
    let captured = '';
    server.use(
      http.get('/api/m0/wiki/products/V-H301W', ({ request }) => {
        captured = new URL(request.url).searchParams.get('as_of') ?? '';
        return HttpResponse.json(envelope(productWiki));
      }),
    );
    await getM0WikiProduct('V-H301W', '2026-08-01T00:00:00Z');
    expect(captured).toBe('2026-08-01T00:00:00Z');
  });

  it('加载 BOM 行与修订 diff', async () => {
    server.use(
      http.get('/api/m0/wiki/products/V-H301W/bom', ({ request }) => {
        const url = new URL(request.url);
        expect(url.searchParams.get('bom')).toBe('BOM-VH301W');
        expect(url.searchParams.get('revision')).toBe('R03');
        return HttpResponse.json(
          envelope({
            bom: 'BOM-VH301W',
            revision: 'R03',
            lines: [{ line_no: '10', material_code: 'YA.C.01.0545012', quantity: 0.0062, uom: 'KG' }],
          }),
        );
      }),
      http.get('/api/m0/wiki/products/V-H301W/bom/diff', ({ request }) => {
        const url = new URL(request.url);
        expect(url.searchParams.get('base')).toBe('R02');
        expect(url.searchParams.get('target')).toBe('R03');
        return HttpResponse.json(
          envelope({
            bom: 'BOM-VH301W',
            base_revision: 'R02',
            target_revision: 'R03',
            added: [{ line_no: '20' }],
            removed: [],
            changed: [{ line_no: '10' }],
          }),
        );
      }),
    );
    const lines = await getM0WikiBomLines('V-H301W', 'BOM-VH301W', 'R03');
    expect(lines.lines).toHaveLength(1);
    const diff = await getM0WikiBomDiff('V-H301W', 'BOM-VH301W', 'R02', 'R03');
    expect(diff.added).toHaveLength(1);
    expect(diff.changed).toHaveLength(1);
  });

  it('物料与设备 Wiki 反查', async () => {
    server.use(
      http.get('/api/m0/wiki/materials/YA.C.01.0545012', () =>
        HttpResponse.json(
          envelope({
            material: { business_key: 'YA.C.01.0545012', label: '45P 黄色插头料' },
            summary: { boms: 1, products: 1, suppliers: 1 },
            history: [],
          }),
        ),
      ),
      http.get('/api/m0/wiki/equipment/EQ-01', () =>
        HttpResponse.json(
          envelope({
            entity: { business_key: 'EQ-01', label: '押出机 1 号' },
            summary: { routes: 2, products: 3 },
            history: [],
          }),
        ),
      ),
    );
    const material = await getM0WikiMaterial('YA.C.01.0545012');
    expect(material.summary.boms).toBe(1);
    const equipment = await getM0WikiEquipment('EQ-01');
    expect(equipment.summary.routes).toBe(2);
  });
});
