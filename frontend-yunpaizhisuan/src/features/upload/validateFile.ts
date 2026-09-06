import { validateM1UploadFile } from '../m1/constants';
import { MAX_M0_FILE_MB, MAX_ORDER_FILE_MB, ORDER_EXTENSIONS } from './uploadConstants';

export type UploadFileKind = 'order' | 'm0' | 'm1';

const readExtension = (name: string) => name.split('.').pop()?.toLowerCase() ?? '';

const isIn = (extensions: string[], extension: string) => extensions.includes(extension);

export function validateFile(
  file: Pick<File, 'name' | 'size'>,
  kind: UploadFileKind,
): string | null {
  if (kind === 'm1') {
    return validateM1UploadFile(file);
  }
  const extension = readExtension(file.name);
  if (kind === 'order') {
    if (!isIn(ORDER_EXTENSIONS, extension)) {
      return `订单文件类型不支持：${extension || '未知'}（支持 ${ORDER_EXTENSIONS.join('、')}）`;
    }
    if (file.size / 1024 / 1024 > MAX_ORDER_FILE_MB) {
      return `订单文件过大：超过 ${MAX_ORDER_FILE_MB}MB，请拆分后上传`;
    }
    return null;
  }
  // M0 deliberately accepts unknown extensions. The backend verifies magic,
  // safety, and physical format before the routing Agent sees any content.
  if (file.size / 1024 / 1024 > MAX_M0_FILE_MB) {
    return `文件过大：超过 ${MAX_M0_FILE_MB}MB，请拆分后上传`;
  }
  return null;
}
