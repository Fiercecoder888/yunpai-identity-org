import { describe, expect, it } from 'vitest';
import { buildOrgTree, orgPathLabel, type OrgNode } from './orgApi';

const nodes: OrgNode[] = [
  { org_id: 'company', parent_id: null, name: '云湃测试厂', org_type: 'company', source: 'manual' },
  { org_id: 'dept:prod', parent_id: 'company', name: '生产部', org_type: 'dept', source: 'manual' },
  { org_id: 'dept:qc', parent_id: 'company', name: '品质部', org_type: 'dept', source: 'derived' },
  { org_id: 'team:prod-a', parent_id: 'dept:prod', name: '生产A班', org_type: 'team', source: 'manual' },
];

describe('orgApi', () => {
  it('builds a three-level tree from flat nodes', () => {
    const tree = buildOrgTree(nodes);
    expect(tree).toHaveLength(1);
    const [root] = tree;
    expect(root?.key).toBe('company');
    expect(root?.children.map((node) => node.key).sort()).toEqual(['dept:prod', 'dept:qc']);
    const prod = root?.children.find((node) => node.key === 'dept:prod');
    expect(prod?.children.map((node) => node.key)).toEqual(['team:prod-a']);
    expect(prod?.children[0]?.orgType).toBe('team');
  });

  it('keeps orphan nodes as roots instead of dropping them', () => {
    const orphan: OrgNode = {
      org_id: 'dept:lost', parent_id: 'dept:missing', name: '孤儿部门', org_type: 'dept', source: 'manual',
    };
    const tree = buildOrgTree([...nodes, orphan]);
    expect(tree.map((node) => node.key)).toEqual(['company', 'dept:lost']);
  });

  it('renders the org path label', () => {
    expect(orgPathLabel(nodes, 'team:prod-a')).toBe('云湃测试厂 / 生产部 / 生产A班');
    expect(orgPathLabel(nodes, null)).toBe('未分配');
    expect(orgPathLabel(nodes, 'dept:unknown')).toBe('dept:unknown');
  });
});
