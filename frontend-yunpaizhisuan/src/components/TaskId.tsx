const HIGHLIGHT_LEN = 7;

export function partitionTaskId(value: string): { before: string; head: string; after: string } {
  const trimmed = (value ?? '').trim();
  if (!trimmed) return { before: '', head: '', after: '' };
  const hash = /([0-9a-fA-F]{8,})/.exec(trimmed);
  if (hash && hash.index !== undefined) {
    const start = hash.index;
    const end = start + hash[0].length;
    const headEnd = Math.min(start + HIGHLIGHT_LEN, end);
    return {
      before: trimmed.slice(0, start),
      head: trimmed.slice(start, headEnd),
      after: trimmed.slice(headEnd),
    };
  }
  return {
    before: '',
    head: trimmed.slice(0, HIGHLIGHT_LEN),
    after: trimmed.slice(HIGHLIGHT_LEN),
  };
}

export function TaskId({ value, className }: { value?: string | null; className?: string }) {
  const text = (value ?? '').trim();
  if (!text) return null;
  const { before, head, after } = partitionTaskId(text);
  return (
    <span className={className ? `task-id ${className}` : 'task-id'} data-testid="task-id">
      {before ? <span className="task-id__prefix">{before}</span> : null}
      <span className="task-id__hash">{head}</span>
      {after ? <span className="task-id__rest">{after}</span> : null}
    </span>
  );
}
