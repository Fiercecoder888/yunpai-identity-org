import { DownloadOutlined, EyeOutlined } from '@ant-design/icons';
import { Button, Modal, Space, Typography } from 'antd';
import { useState } from 'react';
import { docTypeLabel, getM0DocumentFile, m0DocumentFileUrl, type M0MasterDocument } from '../../services/m0DocumentsApi';

export type M0DocLink = { docId: number; title: string; docType?: string };

const PREVIEWABLE_EXTENSIONS = new Set(['.pdf', '.png', '.jpg', '.jpeg', '.gif', '.svg']);

function canPreview(title: string): boolean {
  const extension = `.${title.toLowerCase().split('.').pop()}`;
  return PREVIEWABLE_EXTENSIONS.has(extension);
}

/**
 * 从 list_m0_documents 工具结果中提取文档，渲染人工点击的预览/下载按钮。
 * 预览用 /api/m0/documents/{id}/file（PDF/图片 iframe），下载用文件流 blob。
 */
export function extractM0DocLinks(result: unknown): M0DocLink[] {
  const links: M0DocLink[] = [];
  if (!result || typeof result !== 'object') {
    return links;
  }
  const data = (result as Record<string, unknown>).data;
  if (!data || typeof data !== 'object') {
    return links;
  }
  const documents = (data as Record<string, unknown>).documents;
  if (!Array.isArray(documents)) {
    return links;
  }
  for (const document of documents) {
    if (!document || typeof document !== 'object') {
      continue;
    }
    const doc = document as Partial<M0MasterDocument>;
    if (typeof doc.id !== 'number' || !doc.title) {
      continue;
    }
    links.push({ docId: doc.id, title: doc.title, docType: doc.doc_type });
  }
  return links;
}

export function M0DocArtifacts({ result }: { result?: unknown }) {
  const [previewDoc, setPreviewDoc] = useState<M0DocLink | null>(null);
  const links = extractM0DocLinks(result);
  if (links.length === 0) {
    return null;
  }
  const previewUrl = previewDoc ? m0DocumentFileUrl(previewDoc.docId) : null;

  return (
    <div className="chat-m0-artifacts" data-testid="chat-m0-artifacts">
      <Typography.Text type="secondary">工程文档（人工点击下载/预览）：</Typography.Text>
      <Space wrap>
        {links.map((link) => (
          <span className="chat-m0-artifact-item" key={link.docId}>
            <code>{link.title}</code>
            <Typography.Text type="secondary">{link.docType ? docTypeLabel(link.docType) : ''}</Typography.Text>
            <Button
              size="small"
              icon={<DownloadOutlined />}
              onClick={() => {
                void getM0DocumentFile(link.docId)
                  .then((blob) => {
                    const url = URL.createObjectURL(blob);
                    const anchor = document.createElement('a');
                    anchor.href = url;
                    anchor.download = link.title;
                    anchor.click();
                    URL.revokeObjectURL(url);
                  })
                  .catch(() => undefined);
              }}
            >
              下载
            </Button>
            {canPreview(link.title) ? (
              <Button size="small" icon={<EyeOutlined />} onClick={() => setPreviewDoc(link)}>
                预览
              </Button>
            ) : null}
          </span>
        ))}
      </Space>
      <Modal
        open={previewDoc !== null}
        title={previewDoc?.title ?? '工程文档预览'}
        footer={null}
        width="min(92vw, 1100px)"
        destroyOnHidden
        onCancel={() => setPreviewDoc(null)}
      >
        {previewUrl ? (
          <iframe
            title="工程文档预览"
            src={previewUrl}
            style={{ width: '100%', height: '70vh', border: '1px solid #d7dde3', borderRadius: 4, background: '#fff' }}
          />
        ) : null}
      </Modal>
    </div>
  );
}
