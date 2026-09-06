import { describe, expect, it, beforeEach } from 'vitest';
import type { TestPersonnel } from './testPersonnel';
import {
  TEST_PERSONNEL,
  TEST_PERSONNEL_STORAGE_KEY,
  loadTestPersonnel,
  personnelDisplayName,
  persistSelectedWorkerId,
  readSelectedWorkerId,
  roleLabel,
  saveTestPersonnel,
  searchTestPersonnel,
  toTestPersonnelOptions,
} from './testPersonnel';

describe('testPersonnel', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('provides a searchable test personnel list with 30 workers and 5 leaders', () => {
    const workers = TEST_PERSONNEL.filter((person) => person.role === 'worker');
    const leaders = TEST_PERSONNEL.filter((person) => person.role === 'leader');
    expect(workers).toHaveLength(30);
    expect(leaders).toHaveLength(5);
    expect(new Set(TEST_PERSONNEL.map((person) => person.id)).size).toBe(TEST_PERSONNEL.length);
  });

  it('labels personnel with a role prefix (工人-张三 / 组长-老周)', () => {
    expect(roleLabel('worker')).toBe('工人');
    expect(roleLabel('leader')).toBe('组长');
    expect(personnelDisplayName(TEST_PERSONNEL[0]!)).toBe('工人-张三');
    const leader = TEST_PERSONNEL.find((person) => person.role === 'leader')!;
    expect(personnelDisplayName(leader)).toMatch(/^组长-/);
  });

  it('searches by name, id, station and role prefix', () => {
    expect(searchTestPersonnel('张三').map((person) => person.id)).toContain('worker-zhangsan');
    expect(searchTestPersonnel('worker-li').map((person) => person.id)).toContain('worker-lisi');
    expect(searchTestPersonnel('押出机').some((person) => person.id === 'worker-zhangsan')).toBe(true);
    expect(searchTestPersonnel('组长').every((person) => person.role === 'leader')).toBe(true);
    expect(searchTestPersonnel('不存在的人')).toEqual([]);
    expect(searchTestPersonnel('')).toEqual(TEST_PERSONNEL);
  });

  it('persists a customized personnel list to localStorage and falls back on corruption', () => {
    const custom: TestPersonnel[] = [{ id: 'worker-extra', name: '测试工', role: 'worker', station: '工位 X' }];
    saveTestPersonnel(custom);
    expect(loadTestPersonnel()).toEqual(custom);

    window.localStorage.setItem(TEST_PERSONNEL_STORAGE_KEY, '{broken json');
    expect(loadTestPersonnel()).toEqual(TEST_PERSONNEL);

    window.localStorage.setItem(TEST_PERSONNEL_STORAGE_KEY, JSON.stringify([{ id: 'x' }]));
    expect(loadTestPersonnel()).toEqual(TEST_PERSONNEL);
  });

  it('persists and reads the selected worker id', () => {
    expect(readSelectedWorkerId()).toBe('');
    persistSelectedWorkerId('worker-zhangsan');
    expect(readSelectedWorkerId()).toBe('worker-zhangsan');
    persistSelectedWorkerId('');
    expect(readSelectedWorkerId()).toBe('');
  });

  it('builds antd select options with search text', () => {
    const options = toTestPersonnelOptions([TEST_PERSONNEL[0]!]);
    expect(options[0]?.value).toBe('worker-zhangsan');
    expect(options[0]?.label).toBe('工人-张三');
    expect(String(options[0]?.searchText)).toContain('押出机');
  });
});
