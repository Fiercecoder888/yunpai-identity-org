import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { server } from '../../mocks/server';
import { renderWithApp } from '../../tests/testUtils';
import { DocumentBindingPanel } from './DocumentBindingPanel';
import type { M0MasterDocument } from '../../services/m0DocumentsApi';

const doc: M0MasterDocument = {
  id: 1,
  batch_id: 'M0-BATCH-001',
  domain: 'drawing',
  doc_type: 'engineering_drawing',
  doc_no: '',
  title: '图纸_承认书_ABC-123.pdf',
  content_text: '',
  stored_name: 'mock-drawing.pdf',
  status: 'approved',
  created_at: '2026-08-10T00:00:00Z',
};

describe('DocumentBindingPanel 文档绑定管理', () => {
  it('展示已有绑定并支持新增绑定', async () => {
    const user = userEvent.setup();
    let postedBody: unknown = null;
    server.use(
      http.post('/api/m0/documents/1/bindings', async ({ request }) => {
        postedBody = await request.json();
        return HttpResponse.json({
          success: true,
          data: {
            bindings: [{ id: 12, doc_id: 1, entity_type: 'material', entity_id: 'SO-2026-001', entity_code: 'SO-2026-001', entity_name: '', stage: '', created_by: 'mock', created_at: '2026-08-10T00:00:00Z' }],
          },
          errors: [],
        });
      }),
    );
    renderWithApp(<DocumentBindingPanel doc={doc} onClose={() => {}} />);

    expect(await screen.findByText('HDMI 线材 2M')).toBeInTheDocument();

    await user.type(screen.getByPlaceholderText('如 CABLE-2M / SO-2026…'), 'SO-2026-001');
    await user.click(screen.getByRole('button', { name: '添加绑定' }));

    await waitFor(() =>
      expect(postedBody).toEqual({
        bindings: [{ entity_type: 'material', entity_id: 'SO-2026-001', stage: '' }],
      }),
    );
  });

  it('支持解除绑定', async () => {
    const user = userEvent.setup();
    let deletedId: number | null = null;
    server.use(
      http.delete('/api/m0/documents/bindings/:bindingId', ({ params }) => {
        deletedId = Number(params.bindingId);
        return HttpResponse.json({ success: true, data: { deleted: deletedId }, errors: [] });
      }),
    );
    renderWithApp(<DocumentBindingPanel doc={doc} onClose={() => {}} />);

    await screen.findByText('HDMI 线材 2M');
    await user.click(screen.getByRole('button', { name: '解绑' }));

    await waitFor(() => expect(deletedId).toBe(11));
  });
});
