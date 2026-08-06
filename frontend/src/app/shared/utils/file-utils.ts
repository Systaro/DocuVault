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

/** Material-icons glyph for a file path (used where PNG icons are too heavy, e.g. search results). */
export function getFileIconGlyph(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() || '';
  if (ext === 'md') return 'description';
  if (['html', 'htm'].includes(ext)) return 'code';
  if (['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp'].includes(ext)) return 'image';
  if (ext === 'pdf') return 'picture_as_pdf';
  return 'insert_drive_file';
}

/**
 * Extensions AI editing is never offered for (binary or image formats).
 * Mirrors AI_EDIT_BLOCKED_EXTENSIONS in the backend DocumentController — keep in sync.
 */
const AI_EDIT_BLOCKED_EXTENSIONS = new Set([
  ...IMAGE_EXTENSIONS,
  'tif', 'tiff', 'psd',
  'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'pps', 'odt', 'rtf',
  'zip', '7z', 'rar', 'gz', 'gz2', 'tgz', 'tar', 'iso', 'dmg', 'jar', 'apk', 'msi',
  'mp3', 'mp4', 'mpeg', 'mkv', 'mov', 'avi', 'webm', 'flac', 'ogg', 'wav', 'wma', 'wmv',
  'flv', 'swf', '3gp', 'asf', 'divx', 'aac',
  'exe', 'dll', 'sys', 'bat', 'ttf', 'otf', 'woff', 'woff2', 'eot',
]);

/** True when the file is a text-based document the AI edit feature can work on. */
export function isAiEditable(path: string): boolean {
  return !AI_EDIT_BLOCKED_EXTENSIONS.has(getExtension(path));
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

/**
 * True for dot-files and dot-folders (`.gitkeep`, `.github`, `.gitignore`, …).
 * These are repository plumbing rather than content, so the browsing views hide
 * them while "Pretty names" is on — the same toggle that hides extensions.
 */
export function isHiddenName(name: string): boolean {
  return name.startsWith('.');
}

/** Drops dot-entries from a file tree; a hidden folder takes its subtree with it. */
export function withoutHiddenNodes<T extends { name: string; children?: T[] | null }>(nodes: T[]): T[] {
  return nodes
    .filter(node => !isHiddenName(node.name))
    .map(node => (node.children ? { ...node, children: withoutHiddenNodes(node.children) } : node));
}

/** Percent-encodes each segment of a file path, leaving the separators intact. */
export function encodeFilePath(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/');
}

/** URL a space's file is served from, for signed-in views. */
export function spaceFileUrl(spaceId: string, path: string): string {
  return `/api/spaces/${spaceId}/files/${encodeFilePath(path)}`;
}

/** URL a file inside a shared folder is served from, for the public viewer. */
export function sharedFileUrl(token: string, path: string): string {
  return `/api/shared/${token}/raw/${encodeFilePath(path)}`;
}
