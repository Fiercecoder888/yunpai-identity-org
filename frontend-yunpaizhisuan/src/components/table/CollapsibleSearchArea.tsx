import { DownOutlined, ReloadOutlined, SearchOutlined } from '@ant-design/icons';
import { Button, Card, Form, Input, Select, Space } from 'antd';
import { useRef, useState } from 'react';

export type SearchFieldDef = {
  key: string;
  label: string;
  placeholder?: string;
  width?: number;
  options?: Array<{ value: string; label: string }>;
};

export type SearchFieldValues = Record<string, string | undefined>;

type CollapsibleSearchAreaProps = {
  fields: SearchFieldDef[];
  /** 已提交/初始筛选值；引用变化时内部草稿会跟随重置。 */
  values: SearchFieldValues;
  onSearch: (values: SearchFieldValues) => void;
  onReset: () => void;
  searchText?: string;
  resetText?: string;
  maxInline?: number;
};

const clearedValues = (fields: SearchFieldDef[]): SearchFieldValues =>
  Object.fromEntries(fields.map((field) => [field.key, undefined]));

export function CollapsibleSearchArea({
  fields,
  values,
  onSearch,
  onReset,
  searchText = '查询',
  resetText = '重置',
  maxInline = 3,
}: CollapsibleSearchAreaProps) {
  const [draft, setDraft] = useState<SearchFieldValues>(() => ({ ...values }));
  const [expanded, setExpanded] = useState(false);
  const valuesRef = useRef(values);
  if (!Object.is(valuesRef.current, values)) {
    valuesRef.current = values;
    setDraft({ ...values });
  }

  const visibleFields = expanded ? fields : fields.slice(0, maxInline);
  const hasMore = fields.length > maxInline;

  const updateField = (key: string, value: string | undefined) => {
    setDraft((current) => ({ ...current, [key]: value || undefined }));
  };

  const submit = () => {
    onSearch({ ...draft });
    setExpanded(false);
  };

  const reset = () => {
    setDraft(clearedValues(fields));
    onReset();
  };

  return (
    <Card size="small" className="search-area" data-testid="collapsible-search-area">
      <Form layout="inline" onFinish={submit}>
        {visibleFields.map((field) =>
          field.options ? (
            <Form.Item key={field.key} label={field.label}>
              <Select
                aria-label={field.label}
                allowClear
                value={draft[field.key] ?? undefined}
                style={{ width: field.width ?? 160 }}
                options={field.options}
                onChange={(value) => updateField(field.key, value)}
              />
            </Form.Item>
          ) : (
            <Form.Item key={field.key} label={field.label}>
              <Input
                aria-label={field.label}
                allowClear
                placeholder={field.placeholder}
                value={draft[field.key] ?? ''}
                style={{ width: field.width ?? 200 }}
                onChange={(event) => updateField(field.key, event.target.value)}
                onPressEnter={submit}
              />
            </Form.Item>
          ),
        )}
        <Form.Item>
          <Space>
            <Button type="primary" icon={<SearchOutlined />} htmlType="submit">
              {searchText}
            </Button>
            <Button icon={<ReloadOutlined />} onClick={reset}>
              {resetText}
            </Button>
            {hasMore ? (
              <Button type="link" onClick={() => setExpanded((value) => !value)}>
                {expanded ? '收起' : '展开'} <DownOutlined rotate={expanded ? 180 : 0} />
              </Button>
            ) : null}
          </Space>
        </Form.Item>
      </Form>
    </Card>
  );
}
