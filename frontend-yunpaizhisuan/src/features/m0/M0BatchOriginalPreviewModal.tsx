import { DownloadOutlined, EyeOutlined, ReloadOutlined } from '@ant-design/icons';
import { Alert, Button, Empty, Modal, Select, Skeleton, Space, Tag, Typography } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import {
  getM0BatchDetail,
  m0BatchDocumentFileUrl,
  m0BatchDocumentPreviewUrl,
  type M0Document,
} from '../../services/m0Api';
import styles from './M0BatchOriginalPreviewModal.module.css';

const DIRECT_PREVIEW_FORMATS = new Set([
  'pdf',
  'jpg',
  'jpeg',
  'png',
  'gif',
  'webp',
  'bmp',
  'tif',
  'tiff',
  'txt',
  'text',
  'json',
  'xml',
  'html',
  'htm',
]);

const TABLE_PREVIEW_FORMATS = new Set(['xls', 'xlsx', 'xlsm', 'xlsb', 'csv']);
const SANDBOXED_PREVIEW_FORMATS = new Set(['html', 'htm', 'xml']);
const PREVIEW_TIMEOUT_MS = 15_000;

const documentFormat = (document: M0Document) =>
  (document.detected_format || document.declared_ext || 'unknown').toLowerCase();

function OriginalFileFrame({ document }: { document: M0Document }) {
  const format = documentFormat(document);
  const fileUrl = m0BatchDocumentFileUrl(document.batch_id, document.id);
  const previewUrl = TABLE_PREVIEW_FORMATS.has(format)
    ? m0BatchDocumentPreviewUrl(document.batch_id, document.id)
    : fileUrl;
  const previewable = DIRECT_PREVIEW_FORMATS.has(format) || TABLE_PREVIEW_FORMATS.has(format);
  const sandboxPreview = SANDBOXED_PREVIEW_FORMATS.has(format) || TABLE_PREVIEW_FORMATS.has(format);
  const [status, setStatus] = useState<'loading' | 'loaded' | 'error'>('loading');
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!previewable) return undefined;
    setStatus('loading');
    const timer = window.setTimeout(() => {
      setStatus((current) => (current === 'loading' ? 'error' : current));
    }, PREVIEW_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [previewUrl, previewable, reloadKey]);

  if (!previewable) {
    return (
      <div className={styles.fallback}>
        <Alert
          type="info"
          showIcon
          icon={<EyeOutlined />}
          message={`该格式（${format.toUpperCase()}）不能在浏览器中可靠预览`}
          description="请下载原始文件，并使用对应的桌面应用核对内容。"
          action={
            <a href={fileUrl} target="_blank" rel="noreferrer" download={document.original_name}>
              <Button icon={<DownloadOutlined />}>下载原文件</Button>
            </a>
          }
        />
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div className={styles.fallback}>
        <Alert
          type="error"
          showIcon
          message="原文件预览加载失败"
          description="可重新加载，或下载原始文件进行核对。"
          action={
            <Space wrap>
              <Button icon={<ReloadOutlined />} onClick={() => setReloadKey((key) => key + 1)}>
                重新加载
              </Button>
              <a href={fileUrl} target="_blank" rel="noreferrer" download={document.original_name}>
                <Button icon={<DownloadOutlined />}>下载原文件</Button>
              </a>
            </Space>
          }
        />
      </div>
    );
  }

  return (
    <div className={styles.frameWrap}>
      {status === 'loading' ? (
        <Skeleton active paragraph={{ rows: 10 }} className={styles.loading} />
      ) : null}
      <iframe
        key={reloadKey}
        className={styles.frame}
        title={`原文件预览-${document.original_name}`}
        src={previewUrl}
        sandbox={sandboxPreview ? '' : undefined}
        referrerPolicy="no-referrer"
        onLoad={() => setStatus('loaded')}
        onError={() => setStatus('error')}
      />
    </div>
  );
}

export function M0BatchOriginalPreviewModal({
  batchId,
  open,
  onClose,
}: {
  batchId: string | null;
  open: boolean;
  onClose: () => void;
}) {
  const [selectedDocumentId, setSelectedDocumentId] = useState<number | null>(null);
  const detailQuery = useQuery({
    queryKey: ['m0', 'batch-original-preview', batchId],
    queryFn: () => getM0BatchDetail(batchId as string),
    enabled: open && batchId !== null,
  });
  const documents = useMemo(() => detailQuery.data?.documents ?? [], [detailQuery.data?.documents]);

  useEffect(() => {
    if (!open) return;
    if (documents.length === 0) {
      setSelectedDocumentId(null);
      return;
    }
    setSelectedDocumentId((current) =>
      current !== null && documents.some((document) => document.id === current)
        ? current
        : documents[0]?.id ?? null,
    );
  }, [documents, open]);

  const selectedDocument =
    documents.find((document) => document.id === selectedDocumentId) ?? documents[0] ?? null;
  const selectedFileUrl = selectedDocument
    ? m0BatchDocumentFileUrl(selectedDocument.batch_id, selectedDocument.id)
    : null;

  return (
    <Modal
      open={open}
      title="人工复核 · 原文件"
      onCancel={onClose}
      width="min(96vw, 1200px)"
      destroyOnHidden
      styles={{ body: { paddingTop: 12 } }}
      footer={
        <Space>
          {selectedDocument && selectedFileUrl ? (
            <a
              href={selectedFileUrl}
              target="_blank"
              rel="noreferrer"
              download={selectedDocument.original_name}
            >
              <Button icon={<DownloadOutlined />}>下载原文件</Button>
            </a>
          ) : null}
          <Button type="primary" onClick={onClose}>完成核对</Button>
        </Space>
      }
    >
      <div className={styles.modalBody}>
        {detailQuery.isLoading ? <Skeleton active paragraph={{ rows: 12 }} /> : null}
        {detailQuery.isError ? (
          <Alert
            type="error"
            showIcon
            message="无法获取原文件"
            description={detailQuery.error instanceof Error ? detailQuery.error.message : '请稍后重试'}
            action={<Button onClick={() => void detailQuery.refetch()}>重试</Button>}
          />
        ) : null}
        {!detailQuery.isLoading && !detailQuery.isError && documents.length === 0 ? (
          <Empty description="该识别批次没有可预览的原文件" />
        ) : null}
        {selectedDocument ? (
          <>
            <div className={styles.toolbar}>
              {documents.length > 1 ? (
                <Select
                  className={styles.fileSelect}
                  value={selectedDocument.id}
                  aria-label="选择要核对的原文件"
                  options={documents.map((document) => ({
                    value: document.id,
                    label: document.original_name,
                  }))}
                  onChange={setSelectedDocumentId}
                />
              ) : (
                <Typography.Text strong ellipsis={{ tooltip: selectedDocument.original_name }}>
                  {selectedDocument.original_name}
                </Typography.Text>
              )}
              <Space wrap>
                <Tag color="blue">{documentFormat(selectedDocument).toUpperCase()}</Tag>
                <Tag color={selectedDocument.status === 'needs_review' ? 'gold' : 'green'}>
                  {selectedDocument.status === 'needs_review' ? '待人工复核' : '已识别'}
                </Tag>
              </Space>
            </div>
            <div className={styles.previewArea}>
              <OriginalFileFrame key={selectedDocument.id} document={selectedDocument} />
            </div>
          </>
        ) : null}
      </div>
    </Modal>
  );
}
