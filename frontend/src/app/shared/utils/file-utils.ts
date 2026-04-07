export type RenderMode = 'markdown' | 'html' | 'image' | 'pdf' | 'download';

const IMAGE_EXTENSIONS = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'bmp', 'ico', 'avif'
]);

export function getRenderMode(extension: string): RenderMode {
  const ext = extension.toLowerCase();
  if (ext === 'md') return 'markdown';
  if (ext === 'html' || ext === 'htm') return 'html';
  if (IMAGE_EXTENSIONS.has(ext)) return 'image';
  if (ext === 'pdf') return 'pdf';
  return 'download';
}

export function getFileIcon(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() || '';
  switch (ext) {
    case 'md': return 'description';
    case 'pdf': return 'picture_as_pdf';
    case 'html': case 'htm': return 'code';
    case 'png': case 'jpg': case 'jpeg': case 'gif': case 'svg': case 'webp': return 'image';
    default: return 'insert_drive_file';
  }
}

export function resolveRelativePath(path: string): string {
  const parts = path.split('/');
  const resolved: string[] = [];
  for (const part of parts) {
    if (part === '..') resolved.pop();
    else if (part !== '.' && part !== '') resolved.push(part);
  }
  return resolved.join('/');
}

export function getExtension(path: string): string {
  return path.split('.').pop()?.toLowerCase() || '';
}
