import { Tooltip } from 'antd';
import type { M5FlowStage } from '../../schemas/m5';

const segmentClass = (status: M5FlowStage['status']): string => {
  if (status === 'succeeded') return 'is-success';
  if (status === 'failed' || status === 'blocked') return 'is-failed';
  if (status === 'running' || status === 'queued') return 'is-active';
  return 'is-idle';
};

type StageProgressBarProps = {
  stages: M5FlowStage[];
};

export function StageProgressBar({ stages }: StageProgressBarProps) {
  const label = stages
    .map((stage) => `${stage.label} ${stage.completed}/${stage.total}`)
    .join('；');

  return (
    <div className="stage-progress-bar" role="img" aria-label={label ? `进度阶段：${label}` : '进度阶段：无'}>
      {stages.map((stage) => (
        <Tooltip key={stage.key} title={`${stage.label} ${stage.completed}/${stage.total}`}>
          <span
            className={`stage-progress-segment ${segmentClass(stage.status)}`}
            style={{ flexGrow: stage.total, flexBasis: 0 }}
          />
        </Tooltip>
      ))}
    </div>
  );
}
