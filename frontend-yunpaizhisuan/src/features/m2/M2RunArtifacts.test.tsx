import { describe, expect, it } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { renderWithApp } from '../../tests/testUtils';
import { extractM2ArtifactLinks, M2RunArtifacts } from './M2RunArtifacts';

describe('extractM2ArtifactLinks', () => {
  it('extracts artifact paths from list_m2_runs result', () => {
    const result = {
      success: true,
      data: {
        items: [
          {
            run_id: 'run-1',
            product_name: 'XH041',
            artifact_paths: {
              bom_response_json: '/app/outputs/runs/run-1/bom_generation_response.json',
            },
          },
        ],
        total: 1,
      },
    };
    expect(extractM2ArtifactLinks(result)).toEqual([
      { label: 'XH041 · bom_response_json', path: '/app/outputs/runs/run-1/bom_generation_response.json' },
    ]);
  });

  it('extracts artifact paths from get_m2_run result', () => {
    const result = {
      success: true,
      data: {
        run: {
          run_id: 'run-1',
          artifact_paths: {
            sop_docx: '/app/outputs/runs/run-1/sop/sop.docx',
            sop_center_flowchart_png: '/app/outputs/runs/run-1/sop/center_flowchart.png',
          },
        },
      },
    };
    expect(extractM2ArtifactLinks(result)).toEqual([
      { label: 'sop_docx', path: '/app/outputs/runs/run-1/sop/sop.docx' },
      { label: 'sop_center_flowchart_png', path: '/app/outputs/runs/run-1/sop/center_flowchart.png' },
    ]);
  });

  it('returns empty for unrelated results', () => {
    expect(extractM2ArtifactLinks({ success: true, data: { total: 0 } })).toEqual([]);
    expect(extractM2ArtifactLinks(undefined)).toEqual([]);
  });
});

describe('M2RunArtifacts', () => {
  it('renders download/preview buttons for artifact links', () => {
    renderWithApp(
      <M2RunArtifacts
        result={{
          success: true,
          data: {
            items: [
              {
                run_id: 'run-1',
                product_name: 'XH041',
                artifact_paths: {
                  source_style_bom_xlsx: '/app/outputs/runs/run-1/bom/source_style_bom.xlsx',
                  sop_center_flowchart_png: '/app/outputs/runs/run-1/sop/center_flowchart.png',
                },
              },
            ],
          },
        }}
      />,
    );

    expect(screen.getByTestId('chat-m2-artifacts')).toBeInTheDocument();
    expect(screen.getByText(/source_style_bom_xlsx/)).toBeInTheDocument();
    expect(screen.getByText(/sop_center_flowchart_png/)).toBeInTheDocument();
    const previewButtons = screen.getAllByRole('button', { name: /预览/ });
    expect(previewButtons).toHaveLength(2);
    expect(screen.getAllByRole('button', { name: /下载/ })).toHaveLength(2);

    const previewButton = previewButtons[0];
    if (previewButton) {
      fireEvent.click(previewButton);
    }
    expect(screen.getByTitle('M2 制品预览')).toBeInTheDocument();
    const frame = document.querySelector('iframe[title="M2 制品预览"]');
    expect(frame?.getAttribute('src')).toContain('/api/m2/artifact-preview?path=');
  });

  it('renders nothing without artifact links', () => {
    const { container } = renderWithApp(<M2RunArtifacts result={{ success: true, data: { total: 0 } }} />);
    expect(container.querySelector('[data-testid="chat-m2-artifacts"]')).toBeNull();
  });
});
