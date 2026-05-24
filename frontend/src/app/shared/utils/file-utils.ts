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

/**
 * Extensions for which a dedicated PNG icon exists in
 * `assets/file-icons/file-extension-<ext>-icon.png`.
 * Keep in sync with the files actually shipped under that folder.
 */
const FILE_ICON_EXTENSIONS = new Set([
  '3gp', '7z', 'aac', 'ae', 'ai', 'apk', 'asf', 'avi', 'bak', 'bat',
  'bmp', 'cdr', 'css', 'csv', 'divx', 'dll', 'dmg', 'doc', 'docx', 'dw',
  'dwg', 'eps', 'exe', 'flac', 'flv', 'fw', 'gif', 'gz', 'gz2', 'htm',
  'html', 'ico', 'iso', 'jar', 'jpeg', 'jpg', 'js', 'json', 'log', 'md',
  'mkv', 'mov', 'mp3', 'mp4', 'mpeg', 'msi', 'odt', 'ogg', 'pdf', 'php',
  'png', 'pps', 'ppt', 'pptx', 'ps', 'psd', 'rar', 'rtf', 'svg', 'swf',
  'sys', 'tar', 'tgz', 'tif', 'tiff', 'ts', 'txt', 'wav', 'webm', 'webp',
  'wma', 'wmv', 'xls', 'xlsx', 'xml', 'zip',
]);

/**
 * Returns the URL of a per-extension PNG icon for the given filename, or
 * the generic `unknown` icon if the extension isn't in our shipped set.
 * Designed to be rendered via `<img [src]="getFileIcon(name)">`.
 */
export function getFileIcon(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() || '';
  const slug = FILE_ICON_EXTENSIONS.has(ext) ? ext : 'unknown';
  return `assets/file-icons/file-extension-${slug}-icon.png`;
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
