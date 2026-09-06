import { ClearOutlined, LinkOutlined } from '@ant-design/icons';
import { Alert, Button, Progress, Space, Tag } from 'antd';
import { TaskId } from '../../components/TaskId';
import { useUploadSessionStore, type UploadSession, type UploadSessionKind } from '../../store/useUploadSessionStore';

const KIND_LABELS: Record<UploadSessionKind, string> = {
  order: '订单',
  m0: 'M0 导入',
  m1: 'M0 解析',
};

const STATUS_TAG: Record<UploadSession['status'], { label: string; color: string }> = {
  uploading: { label: '上传中', color: 'processing' },
  processing: { label: '处理中', color: 'processing' },
  success: { label: '完成', color: 'success' },
  failed: { label: '失败', color: 'error' },
  cancelled: { label: '已取消', color: 'default' },
  idle: { label: '待开始', color: 'default' },
};

export function UploadContextBar() {
  const sessions = useUploadSessionStore((state) => state.sessions);
  const remove = useUploadSessionStore((state) => state.remove);
  const reset = useUploadSessionStore((state) => state.reset);

  const items = Object.values(sessions)
    .filter((session) => session.status !== 'idle')
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .slice(0, 4);

  if (items.length === 0) {
    return null;
  }

  return (
    <Alert
      type="info"
      showIcon
      icon={<LinkOutlined />}
      className="upload-context-bar"
      message={
        <Space wrap size={12}>
          {items.map((session) => {
            const meta = STATUS_TAG[session.status];
            const active = session.status === 'uploading' || session.status === 'processing';
            return (
              <span className="upload-context-item" key={session.id}>
                <Tag color="blue">{KIND_LABELS[session.kind] ?? session.kind}</Tag>
                <span className="upload-context-name">{session.filename}</span>
                <Tag color={meta.color}>{meta.label}</Tag>
                {session.taskId ? <TaskId value={session.taskId.slice(0, 16)} /> : null}
                {active ? <Progress percent={session.progress} size="small" style={{ width: 120 }} /> : null}
                <Button type="text" size="small" aria-label={`移除上传记录 ${session.filename}`} onClick={() => remove(session.id)}>
                  移除
                </Button>
              </span>
            );
          })}
          <Button size="small" icon={<ClearOutlined />} onClick={reset}>
            清空
          </Button>
        </Space>
      }
    />
  );
}
