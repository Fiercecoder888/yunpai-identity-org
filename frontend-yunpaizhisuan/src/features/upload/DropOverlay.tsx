import { InboxOutlined } from '@ant-design/icons';
import { Button } from 'antd';
import { useEffect } from 'react';

type DropOverlayProps = {
  visible: boolean;
  onCancel: () => void;
};

export function DropOverlay({ visible, onCancel }: DropOverlayProps) {
  useEffect(() => {
    if (!visible) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCancel();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [visible, onCancel]);

  if (!visible) return null;

  return (
    <div
      className="chat-drop-overlay"
      role="dialog"
      aria-label="拖拽文件上传"
      data-testid="chat-drop-overlay"
    >
      <div className="chat-drop-overlay-panel">
        <InboxOutlined className="chat-drop-overlay-icon" aria-hidden />
        <div className="chat-drop-overlay-title">拖拽文件到此处上传</div>
        <div className="chat-drop-overlay-hint">松开后自动识别并打开订单上传或 M0 数据导入</div>
        <Button className="chat-drop-overlay-cancel" onClick={onCancel}>
          取消
        </Button>
      </div>
    </div>
  );
}
