import { beforeEach, describe, expect, it, vi } from 'vitest';

const { invokeAgent, getJob } = vi.hoisted(() => ({
  invokeAgent: vi.fn(),
  getJob: vi.fn(),
}));

vi.mock('./orchestratorApi', () => ({ invokeAgent, getJob }));

import { upsertM7OrderMaterialRequirement } from './m7Api';

describe('upsertM7OrderMaterialRequirement', () => {
  beforeEach(() => {
    invokeAgent.mockReset();
    getJob.mockReset();
  });

  it('uses the governed orchestrator tool and a stable business idempotency key', async () => {
    invokeAgent.mockResolvedValue({ job_id: 'job-m7-requirement', status: 'queued', tools: [] });
    getJob.mockResolvedValue({ job_id: 'job-m7-requirement', status: 'done', tools: [], steps: [] });

    await upsertM7OrderMaterialRequirement({
      order_id: 'SO-1', material_id: 'MAT-1', material_code: 'MAT-1',
      standard_required_quantity: 80, loss_rate: 0.05, uom: 'pcs', source_version_id: 'manual-v1',
    });

    expect(invokeAgent).toHaveBeenCalledWith(expect.objectContaining({
      tools: ['upsert_m7_order_material_requirement'],
      use_memory: false,
      stop_on_failure: true,
      tool_payloads: {
        upsert_m7_order_material_requirement: expect.objectContaining({
          order_id: 'SO-1', material_id: 'MAT-1', standard_required_quantity: 80,
          idempotency_key: 'requirement:SO-1:MAT-1:manual-v1',
        }),
      },
    }));
    expect(getJob).toHaveBeenCalledWith('job-m7-requirement');
  });

  it('surfaces a failed governed tool job without attempting a direct M7 write', async () => {
    invokeAgent.mockResolvedValue({ job_id: 'job-failed', status: 'queued', tools: [] });
    getJob.mockResolvedValue({ job_id: 'job-failed', status: 'failed', tools: [], steps: [], error: 'forbidden' });

    await expect(upsertM7OrderMaterialRequirement({
      order_id: 'SO-1', material_id: 'MAT-1', material_code: 'MAT-1',
      standard_required_quantity: 80, loss_rate: 0.05, uom: 'pcs', source_version_id: 'manual-v1',
    })).rejects.toThrow('forbidden');
  });
});
