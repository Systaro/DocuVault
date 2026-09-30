export type RenderMode = 'markdown' | 'html' | 'image' | 'pdf' | 'video' | 'audio' | 'download';

const IMAGE_EXTENSIONS = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'bmp', 'ico', 'avif'
]);

/**
 * Formats a browser can play in a <video>/<audio> element. Kept in step with
 * MEDIA_CONTENT_TYPES in the backend's SpaceFileController — a format listed
 * here but not there is served as octet-stream and will not play.
 */
export const VIDEO_EXTENSIONS = new Set(['mp4', 'm4v', 'webm', 'ogv', 'mov']);
export const AUDIO_EXTENSIONS = new Set(['mp3', 'm4a', 'wav', 'oga', 'ogg', 'flac', 'aac']);

/**
 * Files DocuVault has no viewer for. They are offered as a download rather than
 * opened, because the fallback is the text editor — and handing it a zip or a
 * .pptx produced an empty "Untitled" page that looked like the file was gone.
 *
 * This is a list of known-binary formats rather than "anything unrecognised":
 * an unknown extension is far more likely to be text (`.conf`, `.env`, `.rb`)
 * and those still open in the editor, which is the useful behaviour.
 */
const UNRENDERABLE_EXTENSIONS = new Set([
  // Office documents with no in-app viewer (xlsx/xls render as sheets, docx as pages, so not here)
  'doc', 'odt', 'rtf', 'ppt', 'pptx', 'pps', 'odp', 'pages', 'key', 'numbers',
  // Archives and disk images
  'zip', '7z', 'rar', 'gz', 'gz2', 'tgz', 'tar', 'bz2', 'xz', 'iso', 'dmg', 'jar', 'apk', 'msi', 'deb', 'rpm',
  // Media the browser cannot play in a <video>/<audio> element
  'wmv', 'avi', 'mkv', 'flv', 'swf', '3gp', 'asf', 'divx', 'mpeg', 'mpg', 'wma', 'aiff', 'mid', 'midi',
  // Images with no browser support
  'tif', 'tiff', 'psd', 'ai', 'eps', 'raw', 'cr2', 'nef', 'heic',
  // Binaries, libraries and fonts
  'exe', 'dll', 'sys', 'bat', 'so', 'dylib', 'bin', 'dat', 'class', 'pyc', 'o', 'a',
  'ttf', 'otf', 'woff', 'woff2', 'eot',
]);

/** True when there is no viewer for this file and it should be offered for download. */
export function isUnrenderable(path: string): boolean {
  return UNRENDERABLE_EXTENSIONS.has(getExtension(path));
}

export function getRenderMode(extension: string): RenderMode {
  const ext = extension.toLowerCase();
  if (ext === 'md') return 'markdown';
  if (ext === 'html' || ext === 'htm') return 'html';
  if (IMAGE_EXTENSIONS.has(ext)) return 'image';
  if (ext === 'pdf') return 'pdf';
  if (VIDEO_EXTENSIONS.has(ext)) return 'video';
  if (AUDIO_EXTENSIONS.has(ext)) return 'audio';
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

/**
 * Material-icons glyph for a file path (used where PNG icons are too heavy, e.g.
 * search results).
 *
 * The distinctions worth drawing are the ones that change what you get when you
 * click: a page, a rendered document, a picture, a table, a diagram. Anything
 * else is a file you will download, and one glyph covers all of those.
 */
export function getFileIconGlyph(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() || '';
  if (ext === 'md') return 'description';
  if (['html', 'htm'].includes(ext)) return 'code';
  if (IMAGE_EXTENSIONS.has(ext)) return 'image';
  if (ext === 'pdf') return 'picture_as_pdf';
  if (VIDEO_EXTENSIONS.has(ext)) return 'movie';
  if (AUDIO_EXTENSIONS.has(ext)) return 'audiotrack';
  if (['xlsx', 'xls', 'csv', 'ods'].includes(ext)) return 'table_chart';
  if (ext === 'drawio') return 'account_tree';
  if (['doc', 'docx', 'odt', 'rtf'].includes(ext)) return 'article';
  if (['ppt', 'pptx', 'pps', 'odp'].includes(ext)) return 'slideshow';
  if (['zip', '7z', 'rar', 'gz', 'tgz', 'tar', 'iso', 'dmg'].includes(ext)) return 'folder_zip';
  if (['json', 'xml', 'yml', 'yaml', 'js', 'ts', 'css', 'php', 'sh', 'sql'].includes(ext)) return 'data_object';
  if (['txt', 'log'].includes(ext)) return 'notes';
  return 'insert_drive_file';
}

/** Material-icons glyph for a search hit that is a container rather than a file. */
export function getContainerIconGlyph(kind: 'SPACE' | 'GROUP'): string {
  return kind === 'GROUP' ? 'folder_copy' : 'workspaces';
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
