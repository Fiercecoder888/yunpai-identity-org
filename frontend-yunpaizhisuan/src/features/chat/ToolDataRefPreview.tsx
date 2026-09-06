import { EyeOutlined } from '@ant-design/icons';
import { Button, Modal, Typography } from 'antd';
import { useState } from 'react';
import { toApiUrl } from '../../services/apiGateway';
import type { ChatToolDataRef } from '../../services/chatApi';
import { DataPreviewModal, type DataPreviewColumn } from '../business-flow/DataPreviewModal';

const KIND_LABELS: Record<ChatToolDataRef['kind'], string> = {
  bom: 'BOM',
  sop: 'SOP',
  drawing: '图纸',
};

/** 动态列：取首行前 12 个键作为列，避免行字段过多撑爆弹窗 */
const buildColumns = (rows: Array<Record<string, unknown>>): DataPreviewColumn[] => {
  if (!rows.length) return [];
  const first = rows[0] ?? {};
  return Object.keys(first)
    .slice(0, 12)
    .map((key) => ({ key, title: key }));
};

/**
 * 流式工具事件 data_ref 的「预览」按钮：
 * - bom/sop → DataPreviewModal 表格（复用业务流通用预览弹窗）
 * - drawing → Modal + iframe 展示工程图原文件（复用 M2/M0 文件预览模式）
 */
export function ToolDataRefPreview({ dataRef }: { dataRef: ChatToolDataRef }) {
  const [open, setOpen] = useState(false);
  const label = KIND_LABELS[dataRef.kind];
  const isDrawing = dataRef.kind === 'drawing' && Boolean(dataRef.file_url);
  const previewUrl = isDrawing ? toApiUrl(dataRef.file_url as string) : null;

  return (
    <div className="chat-tool-data-ref" data-testid="chat-tool-data-ref">
      <Button size="small" icon={<EyeOutlined />} onClick={() => setOpen(true)}>
        预览 {label}
      </Button>
      {previewUrl ? (
        <Modal
          open={open}
          title={dataRef.title}
          footer={null}
          width="min(92vw, 1100px)"
          destroyOnHidden
          onCancel={() => setOpen(false)}
        >
          <iframe
            title={`${dataRef.title} 预览`}
            src={previewUrl}
            style={{ width: '100%', height: '70vh', border: '1px solid #d7dde3', borderRadius: 4, background: '#fff' }}
          />
        </Modal>
      ) : (
        <DataPreviewModal
          open={open}
          title={dataRef.title}
          columns={buildColumns(dataRef.rows ?? [])}
          rows={dataRef.rows ?? []}
          onClose={() => setOpen(false)}
        />
      )}
      {dataRef.summary ? <Typography.Text type="secondary">{dataRef.summary}</Typography.Text> : null}
    </div>
  );
}
