import { Select, Space, Tag, Typography } from 'antd';
import { useMemo, useState } from 'react';
import {
  loadTestPersonnel,
  persistSelectedWorkerId,
  readSelectedWorkerId,
  roleLabel,
  toTestPersonnelOptions,
  type TestPersonnelRole,
} from './testPersonnel';

export type TestWorkerSelectProps = {
  /** 默认选中值（受控模式下由外部管理）。 */
  value?: string;
  /** 选中变化回调。 */
  onChange?: (workerId: string, label?: string) => void;
  /** 只列出某类角色（worker / leader / 空=全部）。 */
  role?: TestPersonnelRole;
  /** 是否持久化选中值到 localStorage（默认 true）。 */
  persist?: boolean;
  placeholder?: string;
  style?: React.CSSProperties;
  'aria-label'?: string;
  allowClear?: boolean;
  disabled?: boolean;
};

/**
 * 「测试工人」可搜索下拉：从本地测试名单（工人-张三、组长-老周…）选择人员，
 * 支持按姓名/工号/工位搜索；选中值默认持久化到 localStorage，供派工/报工流程复用。
 */
export function TestWorkerSelect({
  value: controlledValue,
  onChange,
  role,
  persist = true,
  placeholder = '选择测试人员（可搜索）',
  style,
  'aria-label': ariaLabel = '测试人员选择',
  allowClear,
  disabled,
}: TestWorkerSelectProps) {
  const personnel = useMemo(() => loadTestPersonnel(), []);
  const options = useMemo(() => {
    const filtered = role ? personnel.filter((person) => person.role === role) : personnel;
    return toTestPersonnelOptions(filtered);
  }, [personnel, role]);

  const [internalValue, setInternalValue] = useState<string>(() =>
    controlledValue ?? readSelectedWorkerId(),
  );
  const value = controlledValue ?? internalValue;

  const handleChange = (workerId?: string) => {
    const next = workerId ?? '';
    if (controlledValue == null) {
      setInternalValue(next);
    }
    if (persist) {
      persistSelectedWorkerId(next);
    }
    const selected = options.find((option) => option.value === next);
    onChange?.(next, selected?.label);
  };

  return (
    <Select
      showSearch
      allowClear={allowClear}
      disabled={disabled}
      aria-label={ariaLabel}
      style={style}
      value={value || undefined}
      placeholder={placeholder}
      options={options}
      filterOption={(input, option) => {
        const searchText = (option?.searchText as string | undefined) ?? String(option?.label ?? '').toLowerCase();
        return searchText.includes(input.trim().toLowerCase());
      }}
      optionRender={(option) => {
        const person = (option.data as { person?: (typeof personnel)[number] } | undefined)?.person;
        return (
          <Space size={8}>
            <Tag color={person?.role === 'leader' ? 'gold' : 'blue'}>{person ? roleLabel(person.role) : ''}</Tag>
            <span>{option.label}</span>
            {person?.station ? (
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                {person.station}
              </Typography.Text>
            ) : null}
            {person?.teamName ? (
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                {person.teamName}
              </Typography.Text>
            ) : null}
          </Space>
        );
      }}
      onChange={handleChange}
    />
  );
}
