import type { AttachmentKind } from './types';

export const ORDER_EXTENSIONS = ['csv', 'xlsx', 'xls', 'zip', 'pdf', 'png', 'jpg', 'jpeg', 'json'];
export const MASTER_DATA_EXTENSIONS = [
  'xlsx', 'xls', 'xlsm', 'csv', 'pdf', 'docx', 'doc', 'pptx', 'dwg', 'dxf', 'png', 'jpg', 'jpeg', 'zip', 'rar', '7z', 'json',
];

export function extensionOf(filename: string) {
  return filename.split('.').pop()?.toLowerCase() ?? '';
}

export function isAllowedFile(filename: string, kind: AttachmentKind) {
  const allowed = kind === 'order' ? ORDER_EXTENSIONS : MASTER_DATA_EXTENSIONS;
  return allowed.includes(extensionOf(filename));
}

export function bytesToBase64(bytes: Uint8Array) {
  let binary = '';
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}

export async function toAttachment(file: File, kind: AttachmentKind, filename = file.name) {
  if (!isAllowedFile(file.name, kind)) throw new Error(`${file.name} 不支持作为${kind === 'order' ? '订单' : '基础资料'}上传`);
  const bytes = new Uint8Array(await file.arrayBuffer());
  return {
    id: `${file.name}-${file.lastModified}-${file.size}`,
    kind,
    filename,
    content_type: file.type || 'application/octet-stream',
    content_b64: bytesToBase64(bytes),
    size: file.size,
  };
}

export function formatBytes(size: number) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}
