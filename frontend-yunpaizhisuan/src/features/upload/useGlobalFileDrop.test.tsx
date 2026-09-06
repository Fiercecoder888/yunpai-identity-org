import { act, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { handleDropFiles, useGlobalFileDrop } from './useGlobalFileDrop';

function Harness({ onFiles }: { onFiles: (files: File[]) => void }) {
  const { isDragging } = useGlobalFileDrop({ onFiles });
  return <div data-testid="drop-zone">{isDragging ? <span data-testid="dragging">dragging</span> : null}</div>;
}

const dispatchDrag = (
  type: string,
  dataTransfer: unknown,
  options?: { relatedTarget?: EventTarget | null },
) => {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'dataTransfer', { value: dataTransfer });
  if (options?.relatedTarget !== undefined) {
    Object.defineProperty(event, 'relatedTarget', { value: options.relatedTarget });
  }
  window.dispatchEvent(event);
};

const fileDataTransfer = (files: File[]) => ({ types: ['Files'], files });

describe('useGlobalFileDrop', () => {
  it('shows the dragging state while a file drag enters the window and clears on leave', () => {
    const onFiles = vi.fn();
    render(<Harness onFiles={onFiles} />);

    act(() => dispatchDrag('dragenter', fileDataTransfer([])));
    expect(screen.getByTestId('dragging')).toBeInTheDocument();

    act(() => dispatchDrag('dragleave', fileDataTransfer([]), { relatedTarget: document.body }));
    expect(screen.queryByTestId('dragging')).not.toBeInTheDocument();
  });

  it('does not activate for non-file drags (text/link)', () => {
    const onFiles = vi.fn();
    render(<Harness onFiles={onFiles} />);

    act(() => dispatchDrag('dragenter', { types: ['text/plain'] }));
    expect(screen.queryByTestId('dragging')).not.toBeInTheDocument();
  });

  it('tracks the counter across nested enter/leave pairs', () => {
    const onFiles = vi.fn();
    render(<Harness onFiles={onFiles} />);

    act(() => dispatchDrag('dragenter', fileDataTransfer([])));
    act(() => dispatchDrag('dragenter', fileDataTransfer([])));
    act(() => dispatchDrag('dragleave', fileDataTransfer([]), { relatedTarget: document.body }));
    expect(screen.getByTestId('dragging')).toBeInTheDocument();
    act(() => dispatchDrag('dragleave', fileDataTransfer([]), { relatedTarget: document.body }));
    expect(screen.queryByTestId('dragging')).not.toBeInTheDocument();
  });

  it('resets the dragging state when leaving the window', () => {
    const onFiles = vi.fn();
    render(<Harness onFiles={onFiles} />);

    act(() => dispatchDrag('dragenter', fileDataTransfer([])));
    expect(screen.getByTestId('dragging')).toBeInTheDocument();

    act(() => dispatchDrag('dragleave', fileDataTransfer([]), { relatedTarget: null }));
    expect(screen.queryByTestId('dragging')).not.toBeInTheDocument();
  });

  it('forwards dropped files to onFiles and clears the dragging state', () => {
    const onFiles = vi.fn();
    render(<Harness onFiles={onFiles} />);
    const orderFile = new File(['order'], 'drop-order.csv', { type: 'text/csv' });

    act(() => dispatchDrag('dragenter', fileDataTransfer([orderFile])));
    act(() => dispatchDrag('drop', fileDataTransfer([orderFile])));

    expect(onFiles).toHaveBeenCalledWith([orderFile]);
    expect(screen.queryByTestId('dragging')).not.toBeInTheDocument();
  });
});

describe('handleDropFiles', () => {
  it('classifies dropped files and picks the destination', () => {
    const orderFile = new File(['order'], 'drop-order.csv');
    const m0File = new File(['plan'], 'plan.dwg');

    expect(handleDropFiles([orderFile])).toEqual({
      destination: 'order-upload',
      orderFiles: [orderFile],
      m0Files: [],
    });
    expect(handleDropFiles([m0File]).destination).toBe('m0-import');
    expect(handleDropFiles([orderFile, m0File]).destination).toBe('order-upload');
    expect(handleDropFiles([]).destination).toBeNull();
  });
});
