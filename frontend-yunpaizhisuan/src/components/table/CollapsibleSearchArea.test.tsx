import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { CollapsibleSearchArea, type SearchFieldDef } from './CollapsibleSearchArea';

const textField: SearchFieldDef = { key: 'keyword', label: '关键字', placeholder: '搜索…', width: 200 };
const riskField: SearchFieldDef = {
  key: 'risk',
  label: '风险',
  width: 140,
  options: [
    { value: 'high', label: '高风险' },
    { value: 'low', label: '低风险' },
  ],
};

describe('CollapsibleSearchArea', () => {
  it('renders fields and the search/reset buttons', () => {
    render(
      <CollapsibleSearchArea
        fields={[textField]}
        values={{}}
        onSearch={() => undefined}
        onReset={() => undefined}
      />,
    );
    expect(screen.getByLabelText('关键字')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /查询/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /重置/ })).toBeInTheDocument();
  });

  it('submits the typed draft values', async () => {
    const user = userEvent.setup();
    const onSearch = vi.fn();
    render(
      <CollapsibleSearchArea
        fields={[textField, riskField]}
        values={{}}
        onSearch={onSearch}
        onReset={() => undefined}
      />,
    );

    await user.type(screen.getByLabelText('关键字'), '轴承');
    await user.click(screen.getByRole('button', { name: /查询/ }));

    expect(onSearch).toHaveBeenCalledWith({ keyword: '轴承', risk: undefined });
  });

  it('calls onReset from the reset button and clears the draft', async () => {
    const user = userEvent.setup();
    const onReset = vi.fn();
    render(
      <CollapsibleSearchArea
        fields={[textField]}
        values={{ keyword: '初始' }}
        onSearch={() => undefined}
        onReset={onReset}
      />,
    );

    await user.click(screen.getByRole('button', { name: /重置/ }));
    expect(onReset).toHaveBeenCalled();
  });

  it('selects a select field value and submits it', async () => {
    const user = userEvent.setup();
    const onSearch = vi.fn();
    render(
      <CollapsibleSearchArea
        fields={[riskField]}
        values={{}}
        onSearch={onSearch}
        onReset={() => undefined}
      />,
    );

    await user.click(screen.getByRole('combobox', { name: '风险' }));
    await user.click(await screen.findByTitle('高风险'));
    await user.click(screen.getByRole('button', { name: /查询/ }));

    expect(onSearch).toHaveBeenCalledWith({ risk: 'high' });
  });

  it('reveals extra fields behind an expand toggle when there are more than maxInline', async () => {
    const user = userEvent.setup();
    const manyFields: SearchFieldDef[] = ['a', 'b', 'c', 'd'].map((key) => ({ key, label: `字段${key}` }));
    render(
      <CollapsibleSearchArea
        fields={manyFields}
        values={{}}
        onSearch={() => undefined}
        onReset={() => undefined}
        maxInline={3}
      />,
    );

    expect(screen.queryByLabelText('字段d')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /展开/ }));
    expect(screen.getByLabelText('字段d')).toBeInTheDocument();
  });
});
