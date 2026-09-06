import { EyeOutlined } from '@ant-design/icons';
import { Button, Modal, Space, Typography } from 'antd';
import { useState } from 'react';
import { m0DocumentFileUrl } from '../../services/m0DocumentsApi';

type DocumentPreviewProps = {
  docId: number;
  title: string;
  triggerLabel?: string;
  compact?: boolean;
};

/**
 * 工程文档预览：iframe 加载 m0 文件流接口（PDF/图片均可），
 * 供组长端 / 工位 / 业务页复用。
 */
export function DocumentPreview({
  docId,
  title,
  triggerLabel = '预览',
  compact = false,
}: DocumentPreviewProps) {
  const [open, setOpen] = useState(false);
  const fileUrl = m0DocumentFileUrl(docId);

  return (
    <>
      <Button
        size={compact ? 'small' : 'middle'}
        type="link"
        icon={<EyeOutlined />}
        aria-label={triggerLabel}
        onClick={() => setOpen(true)}
      >
        {triggerLabel}
      </Button>
      <Modal
        open={open}
        title={title}
        onCancel={() => setOpen(false)}
        footer={null}
        width="min(92vw, 1100px)"
        destroyOnHidden
      >
        <Space direction="vertical" style={{ width: '100%' }}>
          <Typography.Text type="secondary">原始文件流预览（PDF / 图片）</Typography.Text>
          <iframe
            title={`预览-${title}`}
            src={fileUrl}
            style={{
              width: '100%',
              height: '70vh',
              border: '1px solid #d9d9d9',
              borderRadius: 4,
              background: '#fff',
            }}
          />
        </Space>
      </Modal>
    </>
  );
}
