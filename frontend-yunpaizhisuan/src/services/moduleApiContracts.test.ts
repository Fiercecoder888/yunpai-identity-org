import { describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '../mocks/server';
import { downloadM2Artifact, getM2Health, readM2ArtifactJson, runM2Workflow } from './m2Api';
import { calculateM6FinanceCost, getM6Health, importM6FinanceBom } from './m6Api';
import {
  createM8CadDrawingRequest,
  createM8Project,
  getM8Asset,
  getM8CadDrawingAgentContract,
  getM8Health,
  getM8OutputJson,
  getM8OutputText,
  getM8Project,
  getM8Run,
  sendM8ProjectMessage,
  submitM8HumanDecision,
} from './m8Api';

describe('module API contracts for M2/M6/M8', () => {
  it('covers M2 JSON and artifact download endpoints', async () => {
    await expect(getM2Health()).resolves.toMatchObject({ status: 'ok' });
    await expect(runM2Workflow({ order_id: 'ORD-001' })).resolves.toMatchObject({ workflow_id: 'm2-run-001' });
    await expect(downloadM2Artifact('bom.xlsx')).resolves.toBeInstanceOf(Blob);
    await expect(readM2ArtifactJson('sop/parsed_sop.json')).resolves.toMatchObject({ status: 'demo_not_for_release' });
  });

  it('accepts direct M2 workflow payloads without confusing them with demo BOM/SOP APIs', async () => {
    server.use(http.post('/api/m2/run', () => HttpResponse.json({ workflow_id: 'm2-direct-001' })));

    await expect(runM2Workflow({ order_id: 'ORD-001' })).resolves.toMatchObject({ workflow_id: 'm2-direct-001' });
  });

  it('covers M6 envelope-based finance endpoints', async () => {
    await expect(getM6Health()).resolves.toMatchObject({ status: 'ok' });
    await expect(calculateM6FinanceCost({ bom_id: 'BOM-001' })).resolves.toMatchObject({ total_cost: '12800.00' });
    await expect(importM6FinanceBom({ bom_id: 'BOM-001' })).resolves.toMatchObject({ import_id: 'M6-IMP-001' });
  });

  it('throws M6 business errors for success:false envelopes', async () => {
    server.use(http.post('/api/m6/finance/cost', () => HttpResponse.json({ success: false, data: null, errors: [{ message: 'finance failed' }] })));

    await expect(calculateM6FinanceCost({ bom_id: 'BOM-001' })).rejects.toMatchObject({
      error: { code: 'business_error', message: 'finance failed' },
    });
  });

  it('covers M8 project, run, output and asset endpoints', async () => {
    await expect(getM8Health()).resolves.toMatchObject({ status: 'ok' });
    const project = await createM8Project({ name: '非标设计' });
    await expect(getM8Project(project.project_id)).resolves.toMatchObject({ project_id: project.project_id });
    await expect(sendM8ProjectMessage(project.project_id, { message: '开始设计' })).resolves.toMatchObject({ run_id: 'M8-RUN-001' });
    await expect(getM8Run(project.project_id, 'M8-RUN-001')).resolves.toMatchObject({ run_id: 'M8-RUN-001', status: 'done' });
    await expect(submitM8HumanDecision(project.project_id, { accepted: true })).resolves.toMatchObject({ accepted: true });
    await expect(getM8OutputJson(project.project_id, 'summary')).resolves.toMatchObject({ key: 'summary' });
    await expect(getM8OutputText(project.project_id, 'summary.txt')).resolves.toBe('mock output');
    await expect(getM8Asset(project.project_id, 'drawing')).resolves.toBeInstanceOf(Blob);
  });

  it('keeps the M8 CAD drawing capability unavailable when backend returns 501', async () => {
    await expect(getM8CadDrawingAgentContract()).resolves.toMatchObject({ version: 'mock-contract-v1' });
    await expect(createM8CadDrawingRequest('M8-PROJ-001', { prompt: 'draw' })).rejects.toMatchObject({
      error: { status: 501 },
    });
  });
});
