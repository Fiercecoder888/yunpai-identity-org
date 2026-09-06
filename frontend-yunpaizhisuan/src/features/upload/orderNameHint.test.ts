import { describe, expect, it } from 'vitest';
import { buildOrderNameHint } from './orderNameHint';
import type { BusinessCatalogRunConfig } from '../../services/businessFlowRunApi';

const configs: BusinessCatalogRunConfig[] = [
  {
    catalog_id: 'hist-catalog-008',
    order_url: '/orders/CAND-088_TypeC.csv',
    order_filename: 'CAND-088_TypeC数据线.csv',
    m3_input_url: '/m3/CAND-088.json',
    order: {
      order_id: 'SO-HIST-20260724-008',
      product_name: 'Type-C 数据线',
    },
  },
  {
    catalog_id: 'hist-catalog-012',
    order_url: '/orders/HDMI8.xlsx',
    order_filename: 'HDMI8_订单.xlsx',
    m3_input_url: '/m3/HDMI8.json',
    order: {
      order_id: 'SO-HIST-20260724-012',
      product_name: 'HDMI 8 高清线',
    },
  },
];

describe('buildOrderNameHint', () => {
  it('returns the product name on an exact order_filename match', () => {
    expect(buildOrderNameHint(configs, 'CAND-088_TypeC数据线.csv')).toBe('Type-C 数据线');
  });

  it('finds a partial order_filename match', () => {
    expect(buildOrderNameHint(configs, 'CAND-088')).toBe('Type-C 数据线');
  });

  it('matches the product name directly', () => {
    expect(buildOrderNameHint(configs, 'HDMI 8 高清线.pdf')).toBe('HDMI 8 高清线');
  });

  it('returns undefined when nothing matches', () => {
    expect(buildOrderNameHint(configs, 'random.pdf')).toBeUndefined();
    expect(buildOrderNameHint(configs, '')).toBeUndefined();
    expect(buildOrderNameHint([], 'anything.pdf')).toBeUndefined();
  });
});
