import { describe, expect, it } from 'vitest';
import {
  getM1Task,
  isM1TaskFailed,
  isM1TaskSuccessful,
  isM1TaskTerminal,
  uploadOrderFile,
  type M1IngestDetail,
} from './m1IngestApi';

const detail = (overrides: Partial<M1IngestDetail>): M1IngestDetail => ({
  task_id: 'task-1',
  filename: 'order.csv',
  status: 'done',
  needs_review: false,
  ...overrides,
});

describe('m1IngestApi status helpers', () => {
  it('treats done and needs_review as terminal and successful', () => {
    expect(isM1TaskTerminal(detail({ status: 'done' }))).toBe(true);
    expect(isM1TaskSuccessful(detail({ status: 'done' }))).toBe(true);
    expect(isM1TaskSuccessful(detail({ status: 'needs_review' }))).toBe(true);
  });

  it('treats failed and cancelled as terminal failures', () => {
    expect(isM1TaskFailed(detail({ status: 'failed' }))).toBe(true);
    expect(isM1TaskFailed(detail({ status: 'cancelled' }))).toBe(true);
    expect(isM1TaskSuccessful(detail({ status: 'failed' }))).toBe(false);
  });

  it('does not treat queued or running as terminal', () => {
    expect(isM1TaskTerminal(detail({ status: 'queued' }))).toBe(false);
    expect(isM1TaskTerminal(detail({ status: 'running' }))).toBe(false);
  });

  it('normalizes compatibility task ids and review statuses', async () => {
    const accepted = await uploadOrderFile({
      file: new File(['order'], '订单.xlsx'),
      semanticEnrichment: false,
    });
    expect(accepted.task_id).toBe('M1-TASK-001');

    const settled = await getM1Task(accepted.task_id);
    expect(settled).toMatchObject({
      task_id: 'M1-TASK-001',
      filename: '订单图纸-A102.pdf',
      status: 'needs_review',
      needs_review: true,
    });
  });
});
