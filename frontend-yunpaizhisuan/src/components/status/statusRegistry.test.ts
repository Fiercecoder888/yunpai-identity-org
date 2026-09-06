import { describe, expect, it } from 'vitest';
import { statusColor, statusDefinitions, statusLabel } from './statusRegistry';

describe('statusRegistry', () => {
  it('covers the M4 purchase status enum', () => {
    const m4Statuses = [
      'draft',
      'pending_review',
      'rejected',
      'pending_send',
      'sent',
      'replied',
      'parse_pending_review',
      'tracking',
      'alerted',
      'completed',
      'cancelled',
    ];
    for (const status of m4Statuses) {
      expect(statusDefinitions[status], `缺少 M4 状态 ${status}`).toBeDefined();
    }
    expect(statusLabel('replied')).toBe('已回复');
    expect(statusColor('overdue')).toBe('#ef4444');
  });

  it('covers the M5 flow stage and job status enums', () => {
    const m5Statuses = ['not_started', 'queued', 'running', 'succeeded', 'failed', 'blocked', 'dead_letter'];
    for (const status of m5Statuses) {
      expect(statusDefinitions[status], `缺少 M5 状态 ${status}`).toBeDefined();
    }
    expect(statusDefinitions['active']).toBeDefined();
    expect(statusDefinitions['complete']).toBeDefined();
    expect(statusDefinitions['attention']).toBeDefined();
    expect(statusLabel('attention')).toBe('需处理');
  });

  it('covers the M1 task status enum', () => {
    const m1Statuses = ['pending', 'running', 'need_review', 'completed', 'failed', 'cancelled'];
    for (const status of m1Statuses) {
      expect(statusDefinitions[status], `缺少 M1 状态 ${status}`).toBeDefined();
    }
    expect(statusLabel('need_review')).toBe('待审核');
  });

  it('covers the schedule status enum', () => {
    const scheduleStatuses = ['draft', 'solving', 'solved', 'conflict', 'adjusted', 'published'];
    for (const status of scheduleStatuses) {
      expect(statusDefinitions[status], `缺少排程状态 ${status}`).toBeDefined();
    }
    expect(statusLabel('solved')).toBe('已求解');
  });

  it('covers the agent flow node status enum', () => {
    const agentStatuses = ['idle', 'running', 'success', 'failed', 'waiting_human'];
    for (const status of agentStatuses) {
      expect(statusDefinitions[status], `缺少 Agent 状态 ${status}`).toBeDefined();
    }
    expect(statusLabel('waiting_human')).toBe('待人工');
  });

  it('covers the orchestrator job status enum', () => {
    const orchestratorStatuses = ['queued', 'running', 'done', 'partial', 'failed', 'cancelled', 'ok'];
    for (const status of orchestratorStatuses) {
      expect(statusDefinitions[status], `缺少编排器状态 ${status}`).toBeDefined();
    }
    expect(statusLabel('partial')).toBe('部分完成');
  });

  it('covers the M3 material readiness and release recommendation enums', () => {
    const m3Statuses = [
      'ready',
      'allocated_by_fifo',
      'covered_by_stock_or_open_po',
      'shortage',
      'blocked',
      'blocked_by_data_quality',
      'blocked_by_unresolved_shortage',
      'shortage_with_procurement_plan',
      'do_not_release_formal_schedule',
      'allow_draft_schedule_only',
      'ready_for_formal_schedule',
      'blocked_by_procurement_approval',
      'draft_ready_for_external_system',
    ];
    for (const status of m3Statuses) {
      expect(statusDefinitions[status], `缺少 M3 状态 ${status}`).toBeDefined();
    }
    expect(statusLabel('shortage')).toBe('缺料');
  });

  it('falls back to the raw value and default color for unknown statuses', () => {
    expect(statusLabel('unknown_custom_status')).toBe('unknown_custom_status');
    expect(statusColor('unknown_custom_status')).toBe('default');
  });
});
