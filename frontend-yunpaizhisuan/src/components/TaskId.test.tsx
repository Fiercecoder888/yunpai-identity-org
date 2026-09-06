import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { partitionTaskId, TaskId } from './TaskId';

describe('partitionTaskId', () => {
  it('splits the leading 7 chars of a hex hash from the rest', () => {
    expect(partitionTaskId('b1373b74a27d1d9b65074a873202683355cae772')).toEqual({
      before: '',
      head: 'b1373b7',
      after: '4a27d1d9b65074a873202683355cae772',
    });
  });

  it('keeps a non-hex prefix intact before the highlighted hash prefix', () => {
    expect(partitionTaskId('task_a1b2c3d4e5f60718293a4b5c6d7e8f90')).toEqual({
      before: 'task_',
      head: 'a1b2c3d',
      after: '4e5f60718293a4b5c6d7e8f90',
    });
  });

  it('falls back to highlighting the first 7 chars when no hex run is present', () => {
    expect(partitionTaskId('task_real_123')).toEqual({
      before: '',
      head: 'task_re',
      after: 'al_123',
    });
  });

  it('returns empty parts for a blank value', () => {
    expect(partitionTaskId('')).toEqual({ before: '', head: '', after: '' });
  });
});

describe('TaskId', () => {
  it('renders nothing for a blank value', () => {
    const { container } = render(<TaskId value="" />);
    expect(container).toBeEmptyDOMElement();
  });

  it('highlights the hash prefix in a labelled segment', () => {
    render(<TaskId value="task_a1b2c3d4e5f60718293a4b5c6d7e8f90" />);
    expect(screen.getByTestId('task-id')).toBeInTheDocument();
    expect(screen.getByText('task_')).toBeInTheDocument();
    expect(screen.getByText('a1b2c3d')).toBeInTheDocument();
    expect(screen.getByText('4e5f60718293a4b5c6d7e8f90')).toBeInTheDocument();
  });
});
