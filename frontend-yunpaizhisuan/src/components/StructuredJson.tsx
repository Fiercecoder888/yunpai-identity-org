import { Alert, Button, Card, Collapse, Descriptions, Empty, Space, Table, Tooltip, Typography } from 'antd';
import { ArrowsAltOutlined, CopyOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import { useState, type ReactNode } from 'react';
import { isDebugMode } from '../utils/debugMode';

type JsonRecord = Record<string, unknown>;

const DEFAULT_MAX_ROWS = 100;
const DEFAULT_PAGE_SIZE = 20;
const DEFAULT_MAX_FIELDS = 16;
const DEFAULT_MAX_SCALAR_CHARS = 1_000;
const DEBUG_MAX_NODES = 200;
const DEBUG_MAX_ROWS = 20;
const DEBUG_MAX_FIELDS = 16;
const DEBUG_MAX_DEPTH = 4;
const DEBUG_MAX_SCALAR_CHARS = 500;

const isRecord = (value: unknown): value is JsonRecord =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isScalar = (value: unknown) => value === null || ['string', 'number', 'boolean'].includes(typeof value);

const scalarText = (value: unknown) => {
  if (value === null || value === undefined || value === '') {
    return '-';
  }
  return String(value);
};

export const compareJsonScalars = (left: unknown, right: unknown) => {
  const toComparable = (value: unknown): number | string => {
    if (typeof value === 'number') {
      return value;
    }
    if (typeof value === 'boolean') {
      return value ? 1 : 0;
    }
    if (value === null || value === undefined) {
      return '';
    }
    return String(value);
  };
  const a = toComparable(left);
  const b = toComparable(right);
  if (typeof a === 'number' && typeof b === 'number') {
    return a - b;
  }
  return String(a).localeCompare(String(b), 'zh-CN');
};

const uniqueKeys = (rows: JsonRecord[]) => {
  const keys = new Set<string>();
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      keys.add(key);
    }
  }
  return Array.from(keys);
};

const copyToClipboard = async (text: string) => {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fall through to the DOM fallback below.
  }
  try {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    const ok = document.execCommand('copy');
    textarea.remove();
    return ok;
  } catch {
    return false;
  }
};

function RevealAllButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <Button size="small" type="link" icon={<ArrowsAltOutlined />} aria-label={label} onClick={onClick}>
      {label}
    </Button>
  );
}

function FullJsonCopyButton({ data, title }: { data: unknown; title: string }) {
  const [status, setStatus] = useState<'idle' | 'copied' | 'failed'>('idle');

  const handleCopy = async () => {
    try {
      const serialized = JSON.stringify(data, null, 2);
      const ok = await copyToClipboard(serialized === undefined ? scalarText(data) : serialized);
      setStatus(ok ? 'copied' : 'failed');
    } catch {
      setStatus('failed');
    }
    window.setTimeout(() => setStatus('idle'), 1200);
  };

  const tooltip = status === 'copied' ? '已复制完整 JSON' : status === 'failed' ? '复制失败' : '复制完整 JSON';
  return (
    <Tooltip title={tooltip}>
      <Button
        size="small"
        type="text"
        icon={<CopyOutlined />}
        aria-label={`复制完整 JSON：${title}`}
        onClick={(event) => {
          event.stopPropagation();
          void handleCopy();
        }}
      />
    </Tooltip>
  );
}

function ScalarValue({ value }: { value: unknown }) {
  const text = scalarText(value);
  const displayText =
    text.length > DEFAULT_MAX_SCALAR_CHARS
      ? `${text.slice(0, DEFAULT_MAX_SCALAR_CHARS)}...（已截断，共 ${text.length} 字符）`
      : text;
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    const ok = await copyToClipboard(text);
    if (ok) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    }
  };

  return (
    <span className="structured-scalar">
      <Typography.Text>{displayText}</Typography.Text>
      <Tooltip title={copied ? '已复制' : '复制'}>
        <button
          type="button"
          className="structured-scalar-copy"
          aria-label={text.length <= 80 ? `复制 ${text}` : '复制完整值'}
          onClick={() => void handleCopy()}
        >
          <CopyOutlined />
        </button>
      </Tooltip>
    </span>
  );
}

type StructuredJsonLimits = {
  depth?: number;
  maxDepth?: number;
  maxRows?: number;
  maxFields?: number;
};

type RecordsTableProps = StructuredJsonLimits & {
  rows: JsonRecord[];
};

type KeyedJsonRecord = {
  renderKey: string;
  value: JsonRecord;
};

export function RecordsTable({
  rows,
  depth = 0,
  maxDepth = 2,
  maxRows = DEFAULT_MAX_ROWS,
  maxFields = DEFAULT_MAX_FIELDS,
}: RecordsTableProps) {
  const [showAllRows, setShowAllRows] = useState(false);
  const [showAllFields, setShowAllFields] = useState(false);
  const visibleRows = showAllRows ? rows : rows.slice(0, maxRows);
  const keyedRows: KeyedJsonRecord[] = visibleRows.map((value, index) => {
    const candidate =
      typeof value.id === 'string' || typeof value.id === 'number'
        ? String(value.id)
        : typeof value.key === 'string' || typeof value.key === 'number'
          ? String(value.key)
          : 'index';
    return {
      renderKey: `row-${index}-${candidate.slice(0, 80)}`,
      value,
    };
  });
  // Inspect the complete result for column discovery so a field that first
  // appears after the row preview limit is not silently hidden.
  const allKeys = uniqueKeys(rows);
  const keys = showAllFields ? allKeys : allKeys.slice(0, maxFields);
  const columns: ColumnsType<KeyedJsonRecord> = keys.map((key) => ({
    title: key,
    key,
    ellipsis: true,
    sorter: (a, b) => compareJsonScalars(a.value[key], b.value[key]),
    sortDirections: ['ascend', 'descend'] as const,
    render: (_unused: unknown, row) => {
      const value = row.value[key];
      if (isRecord(value) || Array.isArray(value)) {
        return (
          <StructuredJson
            data={value}
            depth={depth + 1}
            maxDepth={maxDepth}
            maxRows={maxRows}
            maxFields={maxFields}
          />
        );
      }
      return <ScalarValue value={value} />;
    },
  }));

  if (rows.length === 0) {
    return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="无数据" />;
  }

  const limitMessages = [
    !showAllRows && rows.length > visibleRows.length
      ? `仅显示前 ${visibleRows.length} 条，共 ${rows.length} 条`
      : null,
    !showAllFields && allKeys.length > keys.length
      ? `仅显示前 ${keys.length} 个字段，共 ${allKeys.length} 个字段`
      : null,
  ].filter(Boolean);

  return (
    <>
      {limitMessages.length > 0 ? (
        <Alert
          className="structured-json-limit"
          type="warning"
          showIcon
          message={limitMessages.join('；')}
          action={(
            <Space size={4} wrap>
              {!showAllRows && rows.length > visibleRows.length ? (
                <RevealAllButton label="显示全部记录" onClick={() => setShowAllRows(true)} />
              ) : null}
              {!showAllFields && allKeys.length > keys.length ? (
                <RevealAllButton label="显示全部字段" onClick={() => setShowAllFields(true)} />
              ) : null}
            </Space>
          )}
        />
      ) : null}
      <Table
        size="small"
        rowKey="renderKey"
        columns={columns}
        dataSource={keyedRows}
        pagination={
          visibleRows.length > DEFAULT_PAGE_SIZE
            ? {
                pageSize: DEFAULT_PAGE_SIZE,
                showSizeChanger: false,
                size: 'small',
              }
            : false
        }
        scroll={{ x: 'max-content' }}
      />
    </>
  );
}

export function RecordDescriptions({
  record,
  maxFields = DEFAULT_MAX_FIELDS,
}: {
  record: JsonRecord;
  maxFields?: number;
}) {
  const [showAllFields, setShowAllFields] = useState(false);
  const allScalarEntries = Object.entries(record).filter(([, value]) => isScalar(value));
  const scalarEntries = showAllFields ? allScalarEntries : allScalarEntries.slice(0, maxFields);
  if (scalarEntries.length === 0) {
    return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="无标量字段" />;
  }
  return (
    <>
      {allScalarEntries.length > scalarEntries.length ? (
        <Alert
          className="structured-json-limit"
          type="warning"
          showIcon
          message={`仅显示前 ${scalarEntries.length} 个标量字段，共 ${allScalarEntries.length} 个`}
          action={<RevealAllButton label="显示全部字段" onClick={() => setShowAllFields(true)} />}
        />
      ) : null}
      <Descriptions size="small" column={2} bordered>
        {scalarEntries.map(([key, value]) => (
          <Descriptions.Item key={key} label={key}>
            <ScalarValue value={value} />
          </Descriptions.Item>
        ))}
      </Descriptions>
    </>
  );
}

type StructuredJsonProps = StructuredJsonLimits & {
  data: unknown;
};

export function StructuredJson({
  data,
  depth = 0,
  maxDepth = 2,
  maxRows = DEFAULT_MAX_ROWS,
  maxFields = DEFAULT_MAX_FIELDS,
}: StructuredJsonProps) {
  const [showAllItems, setShowAllItems] = useState(false);
  const [showAllNestedFields, setShowAllNestedFields] = useState(false);

  if (Array.isArray(data)) {
    if (data.length === 0) {
      return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="无数据" />;
    }
    if (data.every(isRecord)) {
      return (
        <RecordsTable
          rows={data as JsonRecord[]}
          depth={depth}
          maxDepth={maxDepth}
          maxRows={maxRows}
          maxFields={maxFields}
        />
      );
    }
    const visibleItems = showAllItems ? data : data.slice(0, maxRows);
    return (
      <>
        {data.length > visibleItems.length ? (
          <Alert
            className="structured-json-limit"
            type="warning"
            showIcon
            message={`仅显示前 ${visibleItems.length} 项，共 ${data.length} 项`}
            action={<RevealAllButton label="显示全部项目" onClick={() => setShowAllItems(true)} />}
          />
        ) : null}
        <ScalarValue value={visibleItems.map((item) => scalarText(item)).join('、')} />
      </>
    );
  }

  if (isRecord(data)) {
    const scalarEntries = Object.entries(data).filter(([, value]) => isScalar(value));
    const allNestedEntries = Object.entries(data).filter(([, value]) => !isScalar(value));
    const nestedEntries = showAllNestedFields
      ? allNestedEntries
      : allNestedEntries.slice(0, maxFields);
    const nested = nestedEntries.map(([key, value]) => (
      <div className="structured-json-section" key={key}>
        <Typography.Text strong>{key}</Typography.Text>
        <StructuredJson
          data={value}
          depth={depth + 1}
          maxDepth={maxDepth}
          maxRows={maxRows}
          maxFields={maxFields}
        />
      </div>
    ));
    const nestedContent =
      depth >= maxDepth ? (
        <Collapse
          size="small"
          className="structured-json-fold"
          items={[
            {
              key: 'nested',
              label: `嵌套字段（${nestedEntries.length}）`,
              children: <>{nested}</>,
            },
          ]}
        />
      ) : (
        <>{nested}</>
      );
    return (
      <>
        {scalarEntries.length > 0 ? (
          <RecordDescriptions record={data} maxFields={maxFields} />
        ) : null}
        {allNestedEntries.length > nestedEntries.length ? (
          <Alert
            className="structured-json-limit"
            type="warning"
            showIcon
            message={`仅显示前 ${nestedEntries.length} 个嵌套字段，共 ${allNestedEntries.length} 个`}
            action={<RevealAllButton label="显示全部字段" onClick={() => setShowAllNestedFields(true)} />}
          />
        ) : null}
        {nestedContent}
      </>
    );
  }

  return <ScalarValue value={data} />;
}

type JsonDebugCollapseProps = {
  title: string;
  data: unknown;
  debug?: boolean;
};

type DebugPreviewBudget = {
  remaining: number;
};

const debugPreviewValue = (
  value: unknown,
  budget: DebugPreviewBudget,
  seen: WeakSet<object>,
  depth = 0,
): unknown => {
  if (budget.remaining <= 0) {
    return '[truncated: node limit reached]';
  }
  budget.remaining -= 1;

  if (typeof value === 'string') {
    return value.length > DEBUG_MAX_SCALAR_CHARS
      ? `${value.slice(0, DEBUG_MAX_SCALAR_CHARS)}...[truncated ${value.length - DEBUG_MAX_SCALAR_CHARS} chars]`
      : value;
  }
  if (value === null || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  if (value === undefined) {
    return '[undefined]';
  }
  if (typeof value === 'bigint') {
    return `${value.toString()}n`;
  }
  if (typeof value === 'symbol' || typeof value === 'function') {
    return String(value);
  }
  if (seen.has(value)) {
    return '[circular]';
  }
  if (depth >= DEBUG_MAX_DEPTH) {
    return '[truncated: depth limit reached]';
  }
  seen.add(value);

  if (Array.isArray(value)) {
    const visible = value
      .slice(0, DEBUG_MAX_ROWS)
      .map((item) => debugPreviewValue(item, budget, seen, depth + 1));
    if (value.length > DEBUG_MAX_ROWS) {
      visible.push(`[truncated: ${value.length - DEBUG_MAX_ROWS} items omitted]`);
    }
    return visible;
  }

  const record = value as JsonRecord;
  const keys = Object.keys(record);
  const preview: JsonRecord = {};
  for (const key of keys.slice(0, DEBUG_MAX_FIELDS)) {
    preview[key] = debugPreviewValue(record[key], budget, seen, depth + 1);
  }
  if (keys.length > DEBUG_MAX_FIELDS) {
    preview.__yunpai_truncated_fields__ = `${keys.length - DEBUG_MAX_FIELDS} fields omitted`;
  }
  return preview;
};

function BoundedDebugJson({ data }: { data: unknown }) {
  const preview = debugPreviewValue(
    data,
    { remaining: DEBUG_MAX_NODES },
    new WeakSet<object>(),
  );
  return (
    <>
      <div className="raw-json-actions">
        <FullJsonCopyButton data={data} title="调试数据" />
      </div>
      <pre className="raw-json-block">{JSON.stringify(preview, null, 2)}</pre>
    </>
  );
}

export function JsonDebugCollapse({ title, data, debug }: JsonDebugCollapseProps) {
  const show = debug ?? isDebugMode();
  if (!show) {
    return null;
  }
  return (
    <Collapse
      size="small"
      className="json-debug-collapse"
      items={[
        {
          key: 'raw-json',
          label: `${title} · JSON（调试）`,
          children: <BoundedDebugJson data={data} />,
        },
      ]}
    />
  );
}

type StructuredSectionProps = {
  title: string;
  data: unknown;
  debug?: boolean;
  extra?: ReactNode;
  collapsible?: boolean;
  defaultCollapsed?: boolean;
  maxDepth?: number;
  maxRows?: number;
  maxFields?: number;
};

export function StructuredSection({
  title,
  data,
  debug,
  extra,
  collapsible,
  defaultCollapsed,
  maxDepth,
  maxRows,
  maxFields,
}: StructuredSectionProps) {
  const sectionExtra = (
    <Space size={4}>
      {extra}
      <FullJsonCopyButton data={data} title={title} />
    </Space>
  );
  const content = (
    <>
      <StructuredJson
        data={data}
        maxDepth={maxDepth}
        maxRows={maxRows}
        maxFields={maxFields}
      />
      <JsonDebugCollapse title={title} data={data} debug={debug} />
    </>
  );

  if (collapsible) {
    return (
      <Collapse
        size="small"
        className="structured-section-collapse"
        defaultActiveKey={defaultCollapsed ? [] : [title]}
        items={[{ key: title, label: title, extra: sectionExtra, children: content }]}
      />
    );
  }

  return (
    <Card size="small" title={title} extra={sectionExtra} className="structured-json-section-card">
      {content}
    </Card>
  );
}
