import { InboxOutlined, StopOutlined, UploadOutlined } from '@ant-design/icons';
import { Alert, Button, Progress, Space, Typography, Upload, message, type UploadFile } from 'antd';
import { useMemo, useState } from 'react';
import { allowedM1UploadExtensions, maxM1SingleFileSizeMb, validateM1UploadFile } from './constants';
import styles from './M1UploadPanel.module.css';
import { M1TaskProgressList } from './M1TaskProgressList';
import type { M1ArchiveRecognitionResponse, M1BatchRecognitionResponse, M1FailedFile } from '../../services/m1Api';

type M1UploadPanelProps = {
  batchSubmitting: boolean;
  archiveSubmitting: boolean;
  batchResult: M1BatchRecognitionResponse | null;
  archiveResult: M1ArchiveRecognitionResponse | null;
  onBatchSubmit: (files: File[]) => void;
  onArchiveSubmit: (file: File) => void;
  batchProgress?: number;
  onCancelBatch?: () => void;
  batchParentId?: string;
};

const toNativeFile = (file: UploadFile) => file.originFileObj as File | undefined;

function FailedFilesAlert({ title, failedFiles }: { title: string; failedFiles: M1FailedFile[] }) {
  if (failedFiles.length === 0) {
    return null;
  }

  return (
    <Alert
      type="warning"
      showIcon
      message={title}
      description={
        <ul className={styles.failedList}>
          {failedFiles.map((item) => (
            <li key={item.filename}>
              {item.filename}：{item.reason}
            </li>
          ))}
        </ul>
      }
    />
  );
}

export function M1UploadPanel({
  batchSubmitting,
  archiveSubmitting,
  batchResult,
  archiveResult,
  onBatchSubmit,
  onArchiveSubmit,
  batchProgress,
  onCancelBatch,
  batchParentId,
}: M1UploadPanelProps) {
  const [batchFileList, setBatchFileList] = useState<UploadFile[]>([]);
  const [archiveFileList, setArchiveFileList] = useState<UploadFile[]>([]);

  const batchFiles = useMemo(() => batchFileList.map(toNativeFile).filter((file): file is File => Boolean(file)), [batchFileList]);
  const archiveFile = archiveFileList.map(toNativeFile).find((file): file is File => Boolean(file));

  const beforeUpload = (file: File) => {
    const validationError = validateM1UploadFile(file);
    if (validationError) {
      void message.error(validationError);
      return Upload.LIST_IGNORE;
    }
    return false;
  };

  return (
    <Space direction="vertical" size={12} className={styles.stack}>
      <Alert
        type="info"
        showIcon
        message="上传边界"
        description={`支持 ${allowedM1UploadExtensions.join('、')}，单文件上限 ${maxM1SingleFileSizeMb}MB。批量上传和 ZIP 导入均通过 FormData service 提交。`}
      />
      <Upload.Dragger
        className="upload-panel"
        multiple
        beforeUpload={beforeUpload}
        fileList={batchFileList}
        onChange={({ fileList }) => setBatchFileList(fileList)}
      >
        <p className="ant-upload-drag-icon">
          <InboxOutlined />
        </p>
        <p className="ant-upload-text">拖拽 PDF、图片、CAD 或 STEP 文件到此处</p>
        <p className="ant-upload-hint">选择多个文件后提交批量识别；ZIP 请使用下方导入口。</p>
      </Upload.Dragger>
      <div className={styles.actions}>
        <Button type="primary" loading={batchSubmitting} disabled={batchFiles.length === 0} onClick={() => onBatchSubmit(batchFiles)}>
          提交批量识别
        </Button>
        <Upload
          accept=".zip"
          className={styles.archivePicker}
          beforeUpload={beforeUpload}
          fileList={archiveFileList}
          maxCount={1}
          onChange={({ fileList }) => setArchiveFileList(fileList.slice(-1))}
        >
          <Button icon={<UploadOutlined />}>选择 ZIP</Button>
        </Upload>
        <Button loading={archiveSubmitting} disabled={!archiveFile} onClick={() => archiveFile && onArchiveSubmit(archiveFile)}>
          导入 ZIP
        </Button>
        <Typography.Text className={styles.fileHint}>已选择 {batchFiles.length} 个批量文件</Typography.Text>
      </div>
      {batchProgress !== undefined ? (
        <Space direction="vertical" size={4} style={{ width: '100%' }}>
          <Progress percent={batchProgress} size="small" status="active" aria-label={`批量上传进度 ${batchProgress}%`} />
          {onCancelBatch ? (
            <Button danger size="small" icon={<StopOutlined />} onClick={onCancelBatch}>
              取消上传
            </Button>
          ) : null}
        </Space>
      ) : null}
      {batchParentId ? <M1TaskProgressList parentId={batchParentId} /> : null}
      {batchResult ? (
        <Alert
          type={batchResult.failedFiles.length > 0 ? 'warning' : 'success'}
          showIcon
          message={`批量识别已创建 ${batchResult.taskIds.length} 个任务`}
        />
      ) : null}
      <FailedFilesAlert title="部分文件未创建识别任务" failedFiles={batchResult?.failedFiles ?? []} />
      {archiveResult ? (
        <Alert
          type={archiveResult.failedFiles.length > 0 ? 'warning' : 'success'}
          showIcon
          message={`ZIP 导入已创建任务 ${archiveResult.taskId}`}
          description={`已解压 ${archiveResult.extractedFiles} 个文件`}
        />
      ) : null}
      <FailedFilesAlert title="ZIP 内存在未导入文件" failedFiles={archiveResult?.failedFiles ?? []} />
    </Space>
  );
}
