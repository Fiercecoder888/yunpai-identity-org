import { M0_EXTENSIONS, M1_EXTENSIONS, ORDER_EXTENSIONS } from './uploadConstants';

export type FileClass = 'order' | 'm0' | 'm1';
export type DropDestination = 'order-upload' | 'm0-import';

const readExtension = (name: string) => name.split('.').pop()?.toLowerCase() ?? '';

export function classifyFile(filename: string): FileClass | null {
  const extension = readExtension(filename);
  if (!extension) return null;
  if (ORDER_EXTENSIONS.includes(extension)) return 'order';
  if (M0_EXTENSIONS.includes(extension)) return 'm0';
  if (M1_EXTENSIONS.includes(extension)) return 'm1';
  return null;
}

export type ClassifiedFiles<T> = {
  order: T[];
  m0: T[];
  m1: T[];
  unknown: T[];
};

export function classifyFiles<T extends { name: string }>(files: T[]): ClassifiedFiles<T> {
  const result: ClassifiedFiles<T> = { order: [], m0: [], m1: [], unknown: [] };
  for (const file of files) {
    const cls = classifyFile(file.name);
    if (cls) {
      result[cls].push(file);
    } else {
      result.unknown.push(file);
    }
  }
  return result;
}

export function pickDropDestination(files: { name: string }[]): DropDestination | null {
  const classified = classifyFiles(files);
  if (classified.order.length > 0) return 'order-upload';
  if (classified.m0.length > 0) return 'm0-import';
  return null;
}
