import { describe, expect, it } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { renderWithApp } from '../../tests/testUtils';
import { extractM0DocLinks, M0DocArtifacts } from './M0DocArtifacts';

describe('extractM0DocLinks', () => {
  it('extracts documents from list_m0_documents result', () => {
    const result = {
      success: true,
      data: {
        documents: [
          { id: 2, doc_type: 'engineering_drawing', title: '工程图_milan2_CableAdapter_L152mm.pdf' },
        ],
      },
    };
    expect(extractM0DocLinks(result)).toEqual([
      { docId: 2, title: '工程图_milan2_CableAdapter_L152mm.pdf', docType: 'engineering_drawing' },
    ]);
  });

  it('returns empty for unrelated results', () => {
    expect(extractM0DocLinks({ success: true, data: { documents: [] } })).toEqual([]);
    expect(extractM0DocLinks(undefined)).toEqual([]);
  });
});

describe('M0DocArtifacts', () => {
  it('renders preview/download buttons and opens preview modal', () => {
    renderWithApp(
      <M0DocArtifacts
        result={{
          success: true,
          data: {
            documents: [
              { id: 2, doc_type: 'engineering_drawing', title: '工程图_milan2_CableAdapter_L152mm.pdf' },
            ],
          },
        }}
      />,
    );

    expect(screen.getByTestId('chat-m0-artifacts')).toBeInTheDocument();
    expect(screen.getByText(/工程图_milan2/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /下载/ })).toBeInTheDocument();
    const previewButton = screen.getByRole('button', { name: /预览/ });

    fireEvent.click(previewButton);
    expect(screen.getByTitle('工程文档预览')).toBeInTheDocument();
    const frame = document.querySelector('iframe[title="工程文档预览"]');
    expect(frame?.getAttribute('src')).toContain('/api/m0/documents/2/file');
  });

  it('renders nothing without documents', () => {
    const { container } = renderWithApp(<M0DocArtifacts result={{ success: true, data: { documents: [] } }} />);
    expect(container.querySelector('[data-testid="chat-m0-artifacts"]')).toBeNull();
  });

  it('only offers download for non-previewable formats (docx/dwg 等)', () => {
    renderWithApp(
      <M0DocArtifacts
        result={{
          success: true,
          data: {
            documents: [
              { id: 9, doc_type: 'process_method', title: '工艺说明.docx' },
            ],
          },
        }}
      />,
    );
    expect(screen.getByRole('button', { name: /下载/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /预览/ })).toBeNull();
  });
});
