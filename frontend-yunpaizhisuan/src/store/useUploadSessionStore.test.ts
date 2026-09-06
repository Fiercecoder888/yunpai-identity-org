import { afterEach, describe, expect, it } from 'vitest';
import { useUploadSessionStore } from './useUploadSessionStore';

describe('useUploadSessionStore', () => {
  afterEach(() => {
    useUploadSessionStore.getState().reset();
  });

  it('upserts a session and preserves createdAt across updates', () => {
    useUploadSessionStore.getState().upsert('m0-1', { filename: 'a.csv', kind: 'm0', status: 'uploading', progress: 40 });
    const first = useUploadSessionStore.getState().sessions['m0-1'];
    expect(first).toBeDefined();
    expect(first).toMatchObject({ id: 'm0-1', filename: 'a.csv', kind: 'm0', status: 'uploading', progress: 40 });

    useUploadSessionStore.getState().upsert('m0-1', { filename: 'a.csv', kind: 'm0', status: 'success', progress: 100, taskId: 'B-1' });
    const second = useUploadSessionStore.getState().sessions['m0-1'];
    expect(second).toBeDefined();
    expect(second).toMatchObject({ status: 'success', progress: 100, taskId: 'B-1' });
    expect(second!.createdAt).toBe(first!.createdAt);
  });

  it('keeps multiple sessions for multi-order comparison', () => {
    useUploadSessionStore.getState().upsert('order-1', { filename: 'o1.xlsx', kind: 'order', status: 'success', progress: 100, runId: 'R-1' });
    useUploadSessionStore.getState().upsert('order-2', { filename: 'o2.xlsx', kind: 'order', status: 'processing', progress: 60 });
    expect(Object.keys(useUploadSessionStore.getState().sessions)).toHaveLength(2);

    useUploadSessionStore.getState().remove('order-1');
    expect(Object.keys(useUploadSessionStore.getState().sessions)).toEqual(['order-2']);
  });
});
