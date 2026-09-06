export type CsvColumn = {
  key: string;
  title: string;
};

const hasCsvSpecial = (value: string) => /[",\r\n]/.test(value);

/**
 * 转义单个 CSV 单元格：含引号/逗号/换行时用双引号包裹，内部引号双写。
 * 空值与 null/undefined 输出空单元格。
 */
export function escapeCsvValue(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }
  const str = String(value);
  if (hasCsvSpecial(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

const deriveColumns = (rows: Record<string, unknown>[]): CsvColumn[] => {
  const keys: string[] = [];
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      if (!keys.includes(key)) {
        keys.push(key);
      }
    }
  }
  return keys.map((key) => ({ key, title: key }));
};

/** 生成 CSV 文本：BOM \uFEFF 前缀 + 表头 + 数据行（CRLF 换行）。 */
export function buildCsvContent(rows: Record<string, unknown>[], columns?: CsvColumn[]): string {
  const cols = columns && columns.length > 0 ? columns : deriveColumns(rows);
  const header = cols.map((column) => escapeCsvValue(column.title)).join(',');
  const lines = rows.map((row) => cols.map((column) => escapeCsvValue(row[column.key])).join(','));
  return `\uFEFF${[header, ...lines].join('\r\n')}`;
}

export function downloadTextFile(filename: string, content: string, mimeType = 'text/csv;charset=utf-8'): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function exportCsv(filename: string, rows: Record<string, unknown>[], columns?: CsvColumn[]): void {
  downloadTextFile(filename, buildCsvContent(rows, columns));
}
