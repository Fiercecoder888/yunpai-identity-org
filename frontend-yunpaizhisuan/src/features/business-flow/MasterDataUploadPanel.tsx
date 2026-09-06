import { useState } from 'react';
import { useChatStore } from '../../store/useChatStore';

const fileToBase64 = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? '').split(',')[1] ?? '');
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });

/**
 * 基础资料上传 → agent 识别落库入口。
 *
 * 把 BOM/SOP/库存/设备/工位/人员/供应商等「非订单」业务文件以 kind=master_data
 * 交给后端 Planner，由其走「sample_file 采样 → map_to_canonical（多模态理解映射）
 * → ingest_canonical 落库」的 agent 识别链路；识别结果经聊天流回显。
 */
export function MasterDataUploadPanel({ onClose }: { onClose?: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (fileList: FileList | File[]) => {
    const files = Array.from(fileList);
    if (!files.length) return;
    setBusy(true);
    setError(null);
    try {
      const documents = await Promise.all(
        files.map(async (file) => ({
          kind: 'master_data',
          filename: file.name,
          content_type: file.type || 'application/octet-stream',
          content_b64: await fileToBase64(file),
        })),
      );
      await useChatStore.getState().sendMessage(
        '识别并落库这些业务资料（BOM/SOP/库存/设备/工位/人员等），不要走写死规则，交给 agent 理解自主决策',
        undefined,
        undefined,
        { documents },
      );
      onClose?.();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="master-data-upload" aria-label="基础资料上传识别">
      <label>
        <span>{busy ? '正在识别…' : '选择基础资料文件（可多选）'}</span>
        <input
          type="file"
          multiple
          disabled={busy}
          onChange={(event) => {
            if (event.target.files) void submit(event.target.files);
          }}
        />
      </label>
      {error ? <p style={{ color: 'crimson' }}>{error}</p> : null}
    </div>
  );
}
