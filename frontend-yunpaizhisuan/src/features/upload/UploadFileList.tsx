import {
  CloseOutlined,
  FileExcelOutlined,
  FileImageOutlined,
  FileOutlined,
  FilePdfOutlined,
  FileTextOutlined,
  FileZipOutlined,
} from '@ant-design/icons';
import { Button, Tag } from 'antd';

export type UploadListItem = {
  key: string;
  name: string;
  size: number;
  error?: string;
};

type UploadFileListProps = {
  items: UploadListItem[];
  onRemove?: (key: string) => void;
  'data-testid'?: string;
};

const fileTypeIcon = (name: string) => {
  const extension = name.split('.').pop()?.toLowerCase() ?? '';
  if (['xlsx', 'xls', 'xlsm', 'csv'].includes(extension)) return <FileExcelOutlined />;
  if (extension === 'pdf') return <FilePdfOutlined />;
  if (['png', 'jpg', 'jpeg', 'tiff'].includes(extension)) return <FileImageOutlined />;
  if (['zip', 'rar', '7z'].includes(extension)) return <FileZipOutlined />;
  if (['doc', 'docx', 'pptx', 'dwg', 'dxf', 'step', 'stp'].includes(extension)) {
    return <FileTextOutlined />;
  }
  return <FileOutlined />;
};

const formatSize = (size: number) => {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
};

export function UploadFileList({ items, onRemove, 'data-testid': testId }: UploadFileListProps) {
  if (items.length === 0) return null;
  return (
    <div className="upload-file-list" data-testid={testId}>
      {items.map((item) => (
        <div className="upload-file-list-item" key={item.key}>
          <span className="upload-file-list-icon" aria-hidden>
            {fileTypeIcon(item.name)}
          </span>
          <span className="upload-file-list-name" title={item.name}>
            {item.name}
          </span>
          <span className="upload-file-list-size">{formatSize(item.size)}</span>
          {item.error ? <Tag color="error">{item.error}</Tag> : null}
          {onRemove ? (
            <Button
              className="upload-file-list-remove"
              type="text"
              size="small"
              icon={<CloseOutlined />}
              aria-label={`移除 ${item.name}`}
              onClick={() => onRemove(item.key)}
            />
          ) : null}
        </div>
      ))}
    </div>
  );
}
