import { DownloadOutlined, EyeOutlined } from '@ant-design/icons';
import { Button, Modal, Space, Typography } from 'antd';
import { useState } from 'react';
import { toApiUrl, withQuery } from '../../services/apiGateway';
import { downloadM2Artifact } from '../../services/m2Api';
import { getArtifactFileName } from './m2Workflow';

export type M2ArtifactLink = { label: string; path: string };

const TABLE_DOC_EXTENSIONS = new Set(['.xlsx', '.xlsm', '.xls', '.csv', '.docx']);
const RAW_PREVIEW_EXTENSIONS = new Set(['.pdf', '.png', '.jpg', '.jpeg', '.gif', '.svg']);

/**
 * 从 m2 只读工具结果（list_m2_runs / get_m2_run）中提取制品链接：
 * - list_m2_runs: data.items[].artifact_paths
 * - get_m2_run:    data.run.artifact_paths
 * artifact_paths 的值为 /api/m2/artifact?path= 可用的路径。
 */
export function extractM2ArtifactLinks(result: unknown): M2ArtifactLink[] {
  const links: M2ArtifactLink[] = [];
  const collect = (artifactPaths: unknown, prefix: string) => {
    if (!artifactPaths || typeof artifactPaths !== 'object') {
      return;
    }
    for (const [key, value] of Object.entries(artifactPaths as Record<string, unknown>)) {
      if (typeof value === 'string' && value.trim()) {
        links.push({ label: prefix ? `${prefix} · ${key}` : key, path: value });
      }
    }
  };
  if (!result || typeof result !== 'object') {
    return links;
  }
  const data = (result as Record<string, unknown>).data;
  if (!data || typeof data !== 'object') {
    return links;
  }
  const record = data as Record<string, unknown>;
  const items = record.items;
  if (Array.isArray(items)) {
    for (const item of items) {
      if (!item || typeof item !== 'object') {
        continue;
      }
      const entry = item as Record<string, unknown>;
      const label = String(entry.product_name ?? entry.run_id ?? '');
      collect(entry.artifact_paths, label);
    }
  }
  const run = record.run;
  if (run && typeof run === 'object') {
    collect((run as Record<string, unknown>).artifact_paths, '');
  }
  return links;
}

function fileExtension(path: string): string {
  const lower = path.toLowerCase();
  return `.${lower.split('.').pop()}`;
}

function canPreview(path: string): boolean {
  const extension = fileExtension(path);
  return TABLE_DOC_EXTENSIONS.has(extension) || RAW_PREVIEW_EXTENSIONS.has(extension);
}

function previewUrlFor(path: string): string {
  const extension = fileExtension(path);
  const endpoint = TABLE_DOC_EXTENSIONS.has(extension) ? '/m2/artifact-preview' : '/m2/artifact';
  return toApiUrl(withQuery(endpoint, { path }));
}

export function M2RunArtifacts({ result }: { result?: unknown }) {
  const [previewPath, setPreviewPath] = useState<string | null>(null);
  const links = extractM2ArtifactLinks(result);
  if (links.length === 0) {
    return null;
  }
  const previewUrl = previewPath ? previewUrlFor(previewPath) : null;

  return (
    <div className="chat-m2-artifacts" data-testid="chat-m2-artifacts">
      <Typography.Text type="secondary">制品文件（人工点击下载/预览）：</Typography.Text>
      <Space wrap>
        {links.map((link) => (
          <span className="chat-m2-artifact-item" key={`${link.label}-${link.path}`}>
            <code>{link.label}</code>
            <Button
              size="small"
              icon={<DownloadOutlined />}
              onClick={() => {
                void downloadM2Artifact(link.path)
                  .then((blob) => {
                    const url = URL.createObjectURL(blob);
                    const anchor = document.createElement('a');
                    anchor.href = url;
                    anchor.download = getArtifactFileName(link.path);
                    anchor.click();
                    URL.revokeObjectURL(url);
                  })
                  .catch(() => undefined);
              }}
            >
              下载
            </Button>
            {canPreview(link.path) ? (
              <Button size="small" icon={<EyeOutlined />} onClick={() => setPreviewPath(link.path)}>
                预览
              </Button>
            ) : null}
          </span>
        ))}
      </Space>
      <Modal
        open={previewPath !== null}
        title="M2 制品预览"
        footer={null}
        width="min(92vw, 1100px)"
        destroyOnHidden
        onCancel={() => setPreviewPath(null)}
      >
        {previewUrl ? (
          <iframe
            title="M2 制品预览"
            src={previewUrl}
            style={{ width: '100%', height: '70vh', border: '1px solid #d7dde3', borderRadius: 4, background: '#fff' }}
          />
        ) : null}
      </Modal>
    </div>
  );
}
