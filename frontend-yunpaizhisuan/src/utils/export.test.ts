import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildCsvContent, downloadTextFile, escapeCsvValue, exportCsv } from './export';

describe('escapeCsvValue', () => {
  it('keeps plain values unquoted', () => {
    expect(escapeCsvValue('任务 1')).toBe('任务 1');
    expect(escapeCsvValue(3)).toBe('3');
    expect(escapeCsvValue(true)).toBe('true');
  });

  it('outputs empty cells for null and undefined', () => {
    expect(escapeCsvValue(null)).toBe('');
    expect(escapeCsvValue(undefined)).toBe('');
  });

  it('quotes values with commas, quotes or newlines and doubles inner quotes', () => {
    expect(escapeCsvValue('a,b')).toBe('"a,b"');
    expect(escapeCsvValue('带"引号"')).toBe('"带""引号"""');
    expect(escapeCsvValue('line1\nline2')).toBe('"line1\nline2"');
    expect(escapeCsvValue('a\r\nb')).toBe('"a\r\nb"');
  });
});

describe('buildCsvContent', () => {
  it('prepends the BOM and writes header plus rows', () => {
    const content = buildCsvContent([{ name: '轴承', qty: 3 }, { name: '联轴器', qty: '5,5' }]);
    expect(content.startsWith('\uFEFF')).toBe(true);
    expect(content).toContain('name,qty');
    expect(content).toContain('轴承,3');
    expect(content).toContain('联轴器,"5,5"');
  });

  it('uses the provided column titles in order', () => {
    const content = buildCsvContent(
      [{ a: 1, b: 2 }],
      [
        { key: 'b', title: 'B 列' },
        { key: 'a', title: 'A 列' },
      ],
    );
    expect(content).toContain('B 列,A 列');
    expect(content).toContain('2,1');
  });

  it('emits empty rows as an empty line', () => {
    const content = buildCsvContent([{}]);
    expect(content).toBe('\uFEFF\r\n');
  });
});

describe('downloadTextFile', () => {
  let createObjectUrl: ReturnType<typeof vi.fn>;
  let revokeObjectUrl: ReturnType<typeof vi.fn>;
  let clickSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    createObjectUrl = vi.fn(() => 'blob:mock');
    revokeObjectUrl = vi.fn();
    clickSpy = vi.fn();
    vi.stubGlobal('URL', { ...URL, createObjectURL: createObjectUrl, revokeObjectURL: revokeObjectUrl });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(clickSpy);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('creates a blob link and triggers a download', () => {
    downloadTextFile('tasks.csv', '\uFEFFa,b');
    expect(createObjectUrl).toHaveBeenCalledOnce();
    expect(revokeObjectUrl).toHaveBeenCalledWith('blob:mock');
    expect(clickSpy).toHaveBeenCalledOnce();
  });

  it('exportCsv builds BOM content and downloads it', () => {
    exportCsv('out.csv', [{ a: 'x,y' }]);
    const blob = createObjectUrl.mock.calls[0]![0] as Blob;
    expect(blob).toBeInstanceOf(Blob);
    expect(clickSpy).toHaveBeenCalledOnce();
  });
});
