import { Descriptions, Empty, Progress } from 'antd';
import type { M1ReviewItem } from '../../types/api';

type RecognitionResultViewProps = {
  item: M1ReviewItem | null;
};

export function RecognitionResultView({ item }: RecognitionResultViewProps) {
  if (!item) {
    return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="请选择待审核字段" />;
  }

  return (
    <Descriptions size="small" bordered column={1}>
      <Descriptions.Item label="字段名">{item.field}</Descriptions.Item>
      <Descriptions.Item label="识别值">{item.recognizedValue}</Descriptions.Item>
      <Descriptions.Item label="置信度">
        <Progress percent={Math.round(item.confidence * 100)} size="small" status={item.confidence < 0.7 ? 'exception' : 'normal'} />
      </Descriptions.Item>
      <Descriptions.Item label="任务">{item.taskId}</Descriptions.Item>
    </Descriptions>
  );
}
