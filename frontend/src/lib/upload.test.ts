import { describe, expect, it } from 'vitest';
import { extensionOf, formatBytes, isAllowedFile } from './upload';

describe('upload rules', () => {
  it('classifies allowed order and master data extensions', () => {
    expect(extensionOf('订单.XLSX')).toBe('xlsx');
    expect(isAllowedFile('订单.xlsx', 'order')).toBe(true);
    expect(isAllowedFile('设备.dwg', 'master_data')).toBe(true);
    expect(isAllowedFile('运行.exe', 'order')).toBe(false);
  });

  it('formats file sizes for attachment chips', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2048)).toBe('2.0 KB');
  });
});
