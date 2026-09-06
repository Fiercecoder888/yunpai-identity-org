import { describe, expect, it } from 'vitest';
import { validateFile } from './validateFile';
import { MAX_M0_FILE_MB, MAX_ORDER_FILE_MB } from './uploadConstants';
import { maxM1SingleFileSizeMb } from '../m1/constants';

const makeFile = (name: string, size = 1024) =>
  new File([new Uint8Array(size)], name, { type: 'application/octet-stream' });

describe('validateFile(kind=order)', () => {
  it('accepts every order extension case-insensitively', () => {
    for (const extension of ['csv', 'xlsx', 'xls', 'zip', 'pdf', 'png', 'jpg', 'jpeg']) {
      expect(validateFile(makeFile(`file.${extension}`), 'order')).toBeNull();
      expect(validateFile(makeFile(`file.${extension.toUpperCase()}`), 'order')).toBeNull();
    }
  });

  it('rejects unsupported extensions with a descriptive message', () => {
    const error = validateFile(makeFile('plan.dwg'), 'order');
    expect(error).toContain('订单文件类型不支持');
    expect(error).toContain('dwg');
    expect(validateFile(makeFile(''), 'order')).toContain('未知');
  });

  it('rejects files larger than the order size limit', () => {
    const oversize = new File([new Uint8Array((MAX_ORDER_FILE_MB + 1) * 1024 * 1024)], 'big.xlsx');
    expect(validateFile(oversize, 'order')).toContain(`超过 ${MAX_ORDER_FILE_MB}MB`);
    expect(validateFile(oversize, 'order')).toContain('请拆分后上传');
  });

  it('rejects an oversized zip with the same limit as plain files', () => {
    const oversizeZip = new File(
      [new Uint8Array((MAX_ORDER_FILE_MB + 1) * 1024 * 1024)],
      'orders.zip',
      { type: 'application/zip' },
    );
    expect(validateFile(oversizeZip, 'order')).toContain(`超过 ${MAX_ORDER_FILE_MB}MB`);
    // 压缩包与普通文件同一上限口径
    const boundaryZip = new File(
      [new Uint8Array(MAX_ORDER_FILE_MB * 1024 * 1024)],
      'orders.zip',
      { type: 'application/zip' },
    );
    expect(validateFile(boundaryZip, 'order')).toBeNull();
  });
});

describe('validateFile(kind=m0)', () => {
  it('accepts the m0 extension set', () => {
    for (const extension of ['xlsx', 'xls', 'xlsm', 'csv', 'pdf', 'docx', 'doc', 'pptx', 'dwg', 'dxf', 'png', 'jpg', 'jpeg', 'zip', 'rar', '7z']) {
      expect(validateFile(makeFile(`file.${extension}`), 'm0')).toBeNull();
    }
  });

  it('lets unknown extensions reach backend physical-format inspection', () => {
    expect(validateFile(makeFile('model.step'), 'm0')).toBeNull();
    expect(validateFile(makeFile('notes.txt'), 'm0')).toBeNull();
    expect(validateFile(makeFile('no-extension'), 'm0')).toBeNull();
  });

  it('rejects m0 files larger than the backend single-file limit', () => {
    const oversize = new File(
      [new Uint8Array((MAX_M0_FILE_MB + 1) * 1024 * 1024)],
      'big.zip',
      { type: 'application/zip' },
    );
    const error = validateFile(oversize, 'm0');
    expect(error).toContain(`超过 ${MAX_M0_FILE_MB}MB`);
    expect(error).toContain('请拆分后上传');
  });
});

describe('validateFile(kind=m1)', () => {
  it('delegates to the m1 constants validator', () => {
    expect(validateFile(makeFile('scan.tiff'), 'm1')).toBeNull();
    expect(validateFile(makeFile('model.step'), 'm1')).toBeNull();
    expect(validateFile(makeFile('notes.txt'), 'm1')).not.toBeNull();
  });

  it('keeps the m1 size limit in sync', () => {
    const oversize = new File([new Uint8Array((maxM1SingleFileSizeMb + 1) * 1024 * 1024)], 'big.tiff');
    expect(validateFile(oversize, 'm1')).not.toBeNull();
  });
});
