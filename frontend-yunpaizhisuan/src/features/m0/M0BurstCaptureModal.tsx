import {
  CameraOutlined,
  DeleteOutlined,
  LoadingOutlined,
  UploadOutlined,
} from '@ant-design/icons';
import { Alert, Button, Modal, Tag, Typography, message } from 'antd';
import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { previewM0Batch } from '../../services/m0Api';
import {
  describeM0UploadError,
  uploadM0FilesWithProgress,
} from '../../services/uploadWithProgress';
import { validateFile } from '../upload/validateFile';
import styles from './M0BurstCaptureModal.module.css';

export type BurstShotStatus = 'uploading' | 'processing' | 'awaiting_review' | 'ready' | 'failed';

export type BurstShot = {
  key: string;
  name: string;
  status: BurstShotStatus;
  batchId: string | null;
  error?: string;
};

const SHOT_STATUS_META: Record<BurstShotStatus, { label: string; color: string }> = {
  uploading: { label: '上传中', color: 'blue' },
  processing: { label: '识别中', color: 'processing' },
  awaiting_review: { label: '待审核', color: 'gold' },
  ready: { label: '可入库', color: 'green' },
  failed: { label: '失败', color: 'red' },
};

/** 服务端批次处于这些状态时需要继续轮询（与 M0ChatPanel 2s 轮询口径一致）。 */
const mapBatchStatus = (status: string): BurstShotStatus => {
  if (status === 'awaiting_review' || status === 'ready') return status;
  if (status === 'failed') return 'failed';
  return 'processing';
};

const describeCameraError = (error: unknown): string => {
  if (error instanceof DOMException) {
    if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError') {
      return '相机权限被拒绝：请在浏览器地址栏允许访问相机，或改用「拍照上传」';
    }
    if (error.name === 'NotFoundError' || error.name === 'DevicesNotFoundError') {
      return '未检测到可用相机设备，请改用「拍照上传」选择照片';
    }
    if (error.name === 'NotReadableError') {
      return '相机正被其他应用占用，请关闭占用相机的应用后重试';
    }
    if (error.name === 'OverconstrainedError') {
      return '当前设备不支持后置相机取景，请改用「拍照上传」';
    }
  }
  return '无法打开相机，请改用「拍照上传」选择照片';
};

type M0BurstCaptureModalProps = {
  open: boolean;
  onClose: () => void;
  onRecognized?: (batchId: string) => void;
  allowDocuments?: boolean;
  fileUploadOnly?: boolean;
};

/**
 * 连拍扫描（方案 A）：getUserMedia 实时取景 → 每点一次「拍照」用 canvas 截取一帧 →
 * 立即单独上传（每张照片一个请求、一个独立 batch，m0 后端 wait=false 异步识别）。
 * 队列逐张显示 上传中/识别中/待审核/可入库/失败 状态；失败可删除重拍。
 * getUserMedia 不可用/权限被拒时降级为 input capture（方案 B）系统相机拍照。
 */
export function M0BurstCaptureModal({
  open,
  onClose,
  onRecognized,
  allowDocuments = false,
  fileUploadOnly = false,
}: M0BurstCaptureModalProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const fallbackInputRef = useRef<HTMLInputElement>(null);
  const documentInputRef = useRef<HTMLInputElement>(null);
  const onRecognizedRef = useRef(onRecognized);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [videoReady, setVideoReady] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [shots, setShots] = useState<BurstShot[]>([]);
  const shotsRef = useRef<BurstShot[]>([]);
  useEffect(() => {
    shotsRef.current = shots;
  }, [shots]);
  useEffect(() => {
    onRecognizedRef.current = onRecognized;
  }, [onRecognized]);

  // 打开弹窗时启动相机；关闭/卸载时停止所有轨道（释放摄像头）。
  useEffect(() => {
    if (!open || fileUploadOnly) return;
    let disposed = false;
    let activeStream: MediaStream | null = null;
    setCameraError(null);
    setVideoReady(false);
    const startCamera = async () => {
      const mediaDevices = navigator.mediaDevices;
      if (!mediaDevices?.getUserMedia) {
        if (!disposed) {
          setCameraError('当前浏览器不支持实时取景（getUserMedia 不可用），已降级为系统相机拍照');
        }
        return;
      }
      try {
        const mediaStream = await mediaDevices.getUserMedia({
          video: { facingMode: 'environment' },
          audio: false,
        });
        if (disposed) {
          mediaStream.getTracks().forEach((track) => track.stop());
          return;
        }
        activeStream = mediaStream;
        setStream(mediaStream);
      } catch (error) {
        if (!disposed) {
          setCameraError(describeCameraError(error));
        }
      }
    };
    void startCamera();
    return () => {
      disposed = true;
      activeStream?.getTracks().forEach((track) => track.stop());
      setStream(null);
    };
  }, [fileUploadOnly, open]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !stream) return;
    video.srcObject = stream;
    void video.play().catch(() => {
      // 自动播放被拦截时忽略：点击「拍照」前的画面刷新不影响 capture 可用性。
    });
  }, [stream]);

  // 每 2 秒轮询「识别中」照片对应的批次状态（与 M0ChatPanel 轮询口径一致）。
  useEffect(() => {
    if (!open) return;
    let disposed = false;
    const tick = async () => {
      const active = shotsRef.current.filter((shot) => shot.batchId && shot.status === 'processing');
      for (const shot of active) {
        try {
          const preview = await previewM0Batch(shot.batchId as string);
          if (disposed) return;
          const next = mapBatchStatus(preview.batch.status);
          if (next !== shot.status) {
            setShots((prev) => prev.map((item) => (item.key === shot.key ? { ...item, status: next } : item)));
            if (next === 'ready' || next === 'awaiting_review') onRecognizedRef.current?.(shot.batchId as string);
          }
        } catch {
          // 单次轮询失败不致命，下一轮重试。
        }
      }
    };
    const timer = window.setInterval(() => {
      void tick();
    }, 2_000);
    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, [open]);

  const uploadBatch = async (files: File[], displayName: string) => {
    for (const file of files) {
      const validationError = validateFile(file, 'm0');
      if (validationError) {
        void message.error(validationError);
        return;
      }
    }
    const shot: BurstShot = {
      key: `${displayName}-${Math.random().toString(36).slice(2, 8)}`,
      name: displayName,
      status: 'uploading',
      batchId: null,
    };
    setShots((prev) => [shot, ...prev]);
    try {
      // 拍照保持单文件批次；一次选择的关联文档进入同一批次，便于合并结构化证据。
      const batch = await uploadM0FilesWithProgress(files);
      setShots((prev) =>
        prev.map((item) =>
          item.key === shot.key
            ? { ...item, batchId: batch.id, status: mapBatchStatus(batch.status) }
            : item,
        ),
      );
      if (batch.status === 'ready' || batch.status === 'awaiting_review') onRecognizedRef.current?.(batch.id);
    } catch (error) {
      setShots((prev) =>
        prev.map((item) =>
          item.key === shot.key ? { ...item, status: 'failed', error: describeM0UploadError(error) } : item,
        ),
      );
    }
  };

  const uploadShot = (file: File) => uploadBatch([file], file.name);

  const captureFrame = () => {
    const video = videoRef.current;
    if (!video || !videoReady || video.videoWidth === 0 || capturing) return;
    setCapturing(true);
    try {
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const context = canvas.getContext('2d');
      if (!context) {
        setCapturing(false);
        return;
      }
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      canvas.toBlob(
        (blob) => {
          setCapturing(false);
          if (!blob) return;
          const file = new File([blob], `scan-${Date.now()}.jpg`, { type: 'image/jpeg' });
          void uploadShot(file);
        },
        'image/jpeg',
        0.92,
      );
    } catch {
      setCapturing(false);
    }
  };

  // 降级入口（方案 B）：getUserMedia 不可用/权限被拒时，用 input capture 系统相机拍照，
  // 每张照片同样单独上传（独立 batch），队列语义保持一致。
  const handleFallbackFiles = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = '';
    if (files.length === 0) return;
    files.forEach((file) => void uploadShot(file));
  };

  const handleDocumentFiles = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = '';
    if (files.length === 0) return;
    const displayName = files.length === 1 ? (files[0]?.name ?? '关联文件') : `${files.length} 个关联文件`;
    void uploadBatch(files, displayName);
  };

  const activeCount = shots.filter((shot) => shot.status === 'uploading' || shot.status === 'processing').length;

  return (
    <Modal
      title={fileUploadOnly ? '上传送货单文件' : allowDocuments ? '拍照或文件识别' : '连拍扫描 · 随拍随识别'}
      open={open}
      onCancel={onClose}
      width="min(94vw, 640px)"
      className="m0-burst-modal"
      footer={[
        <Button key="done" type="primary" onClick={onClose}>
          完成{activeCount > 0 ? `（${activeCount} 张识别中）` : ''}
        </Button>,
      ]}
    >
      {fileUploadOnly ? (
        <Alert
          type="info"
          showIcon
          message="选择送货单或关联文件"
          description="文件将交给 M0 与 M1 识别；识别完成后，缺失信息会回到对话中继续补充。"
        />
      ) : cameraError ? (
        <div className={styles.cameraError}>
          <Alert type="warning" showIcon message="相机不可用" description={cameraError} />
          <input
            ref={fallbackInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            multiple
            data-testid="m0-burst-fallback-input"
            className={styles.cameraInput}
            onChange={handleFallbackFiles}
          />
          <Button icon={<CameraOutlined />} onClick={() => fallbackInputRef.current?.click()}>
            改用系统相机拍照
          </Button>
        </div>
      ) : (
        <div className={styles.viewfinder}>
          <video
            ref={videoRef}
            className={styles.video}
            muted
            playsInline
            autoPlay
            onLoadedMetadata={() => setVideoReady(true)}
          />
          {!videoReady ? (
            <div className={styles.videoPlaceholder}>
              <LoadingOutlined /> 正在启动相机…
            </div>
          ) : null}
          <Button
            type="primary"
            size="large"
            icon={<CameraOutlined />}
            className={styles.captureButton}
            disabled={!videoReady || capturing}
            loading={capturing}
            onClick={captureFrame}
          >
            拍照（已拍 {shots.length} 张）
          </Button>
        </div>
      )}

      {allowDocuments ? (
        <div>
          <input
            ref={documentInputRef}
            type="file"
            accept=".pdf,.docx,.doc,.xlsx,.xls,.xlsm,.xlsb,.csv,.png,.jpg,.jpeg,.bmp,.tif,.tiff,.webp,.gif,.txt,.json,.xml,.html,.htm,.ppt,.pptx,.zip,.tar,.rar,.7z,.dwg,.dxf,.dwt"
            multiple
            data-testid="m0-burst-document-input"
            className={styles.cameraInput}
            onChange={handleDocumentFiles}
          />
          <Button
            type={fileUploadOnly ? 'primary' : 'default'}
            size={fileUploadOnly ? 'large' : 'middle'}
            className={fileUploadOnly ? styles.fileUploadButton : undefined}
            icon={<UploadOutlined />}
            onClick={() => documentInputRef.current?.click()}
          >
            选择送货文件
          </Button>
        </div>
      ) : null}

      <div className={styles.shotList} data-testid="m0-burst-shot-list">
        {shots.length === 0 ? (
          <Typography.Text type="secondary" className={styles.emptyHint}>
            {fileUploadOnly
              ? '支持图片、PDF、Word、Excel、CSV 和压缩包；可一次选择多个关联文件。'
              : '拍摄后每张照片立即上传识别（每张独立批次，互不阻塞）；「完成」关闭取景，未拍完可继续拍。'}
          </Typography.Text>
        ) : (
          shots.map((shot) => (
            <div className={styles.shotItem} key={shot.key}>
              {shot.status === 'uploading' || shot.status === 'processing' ? (
                <LoadingOutlined className={styles.shotSpinner} aria-hidden />
              ) : null}
              <span className={styles.shotName} title={shot.name}>
                {shot.name}
              </span>
              <Tag color={SHOT_STATUS_META[shot.status].color}>{SHOT_STATUS_META[shot.status].label}</Tag>
              {shot.error ? <span className={styles.shotError} title={shot.error}>{shot.error}</span> : null}
              {shot.status === 'failed' ? (
                <Button
                  type="text"
                  size="small"
                  icon={<DeleteOutlined />}
                  aria-label={`删除 ${shot.name}（可重拍）`}
                  onClick={() => setShots((prev) => prev.filter((item) => item.key !== shot.key))}
                />
              ) : null}
            </div>
          ))
        )}
      </div>
    </Modal>
  );
}
