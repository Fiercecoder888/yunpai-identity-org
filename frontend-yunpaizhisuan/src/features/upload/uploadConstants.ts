import { allowedM1UploadExtensions } from '../m1/constants';

export const ORDER_EXTENSIONS: string[] = ['csv', 'xlsx', 'xls', 'zip', 'pdf', 'png', 'jpg', 'jpeg'];

export const M0_EXTENSIONS: string[] = [
  'xlsx', 'xls', 'xlsm', 'csv', 'pdf', 'docx', 'doc', 'pptx', 'dwg', 'dxf',
  'png', 'jpg', 'jpeg', 'zip', 'rar', '7z',
];

export const M1_EXTENSIONS: string[] = allowedM1UploadExtensions;

// 订单文件统一上限（普通文件与压缩包同一口径：按文件压缩后大小计算）。
// 网关 /api/orchestrator/ 的 client_max_body_size 已放宽到 150m，
// 容纳 base64 编码放大 ~4/3（100MB 文件 base64 后约 133MB），
// 因此不再需要单独的 base64 安全上限。
export const MAX_ORDER_FILE_MB = 100;

// m0 数据建设单文件上限，与 m0 后端 max_single_bytes(512MB) 保持一致。
export const MAX_M0_FILE_MB = 512;
