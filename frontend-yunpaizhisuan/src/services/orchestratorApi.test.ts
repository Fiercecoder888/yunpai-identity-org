import { describe, expect, it } from 'vitest';
import { getJob, invokeAgent, listJobs, searchSimilarMemory } from './orchestratorApi';

describe('orchestratorApi', () => {
  it('invokes an agent and reads a completed job', async () => {
    const submitted = await invokeAgent({ task: '检查订单风险' });
    const job = await getJob(submitted.job_id);

    expect(submitted).toMatchObject({ job_id: 'orch-job-001', status: 'running' });
    expect(job).toMatchObject({ job_id: 'orch-job-001', status: 'done' });
    expect(submitted.tools).toEqual(['list_m5_schedules']);
    expect(job.tools).toEqual(['list_m5_schedules']);
    expect(job.steps[0]).toMatchObject({ tool: 'list_m5_schedules', status: 'ok' });
    expect(job.steps.length).toBeGreaterThan(0);
  });

  it('lists jobs and searches similar memory through gateway paths', async () => {
    await expect(listJobs({ session_id: 'mock-session', limit: 5 })).resolves.toHaveLength(1);
    await expect(searchSimilarMemory({ task: '排程', top_k: 3 })).resolves.toMatchObject({ items: [] });
  });

});
