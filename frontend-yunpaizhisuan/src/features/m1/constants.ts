export const allowedM1UploadExtensions = ['pdf', 'png', 'jpg', 'jpeg', 'tiff', 'dwg', 'dxf', 'step', 'stp', 'zip'];
export const maxM1SingleFileSizeMb = 100;

export function validateM1UploadFile(file: Pick<File, 'name' | 'size'>) {
  const extension = file.name.split('.').pop()?.toLowerCase() ?? '';
  if (!allowedM1UploadExtensions.includes(extension)) {
    return '文件类型不支持';
  }
  if (file.size / 1024 / 1024 > maxM1SingleFileSizeMb) {
    return '文件过大';
  }
  return null;
}
