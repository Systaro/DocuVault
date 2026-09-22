import { computed, signal } from '@angular/core';
import { HttpErrorResponse, HttpEventType } from '@angular/common/http';
import { Subscription } from 'rxjs';
import {
  Attachment, AttachmentKind, AttachmentsService, MAX_ATTACHMENT_BYTES, MAX_ATTACHMENTS
} from '../../core/api/attachments.service';
import { ToastService } from './toast.service';

export interface PendingAttachment {
  localId: string;
  name: string;
  size: number;
  kind: AttachmentKind;
  /** Local preview of an image, until the page is left. */
  previewUrl: string | null;
  progress: number;
  status: 'uploading' | 'ready' | 'error';
  error?: string;
  /** What happens with the file after the upload, e.g. "Reading the handwriting". */
  note?: string;
  attachment?: Attachment;
}

/** Photos bigger than this are scaled down before upload: plenty for handwriting, a fraction of the bytes. */
const MAX_IMAGE_EDGE = 2400;
const SCALABLE_IMAGES = ['image/jpeg', 'image/png', 'image/webp'];
const TEXT_EXTENSIONS = ['txt', 'md', 'markdown', 'csv', 'tsv'];

export function attachmentKindOf(file: File): AttachmentKind | null {
  const extension = file.name.split('.').pop()?.toLowerCase() ?? '';
  if (file.type.startsWith('image/') && ['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(file.type)) return 'IMAGE';
  if (file.type === 'application/pdf' || extension === 'pdf') return 'PDF';
  if (TEXT_EXTENSIONS.includes(extension)) return 'TEXT';
  return null;
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** Scales a large photo down in the browser; anything else goes up unchanged. */
async function prepare(file: File): Promise<{ blob: Blob; name: string }> {
  if (!SCALABLE_IMAGES.includes(file.type) || typeof createImageBitmap === 'undefined') return { blob: file, name: file.name };
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_IMAGE_EDGE / Math.max(bitmap.width, bitmap.height));
    if (scale === 1 && file.size <= 4 * 1024 * 1024) {
      bitmap.close();
      return { blob: file, name: file.name };
    }
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.9));
    if (!blob) return { blob: file, name: file.name };
    return { blob, name: file.name.replace(/\.(png|webp|jpe?g)$/i, '') + '.jpg' };
  } catch {
    return { blob: file, name: file.name };
  }
}

/**
 * Files on their way to the assistant: each one uploads as soon as it is
 * added, with its own progress, and can be removed until the message is sent.
 * One queue per composer; call [destroy] when the composer goes away.
 */
export class AttachmentQueue {
  readonly items = signal<PendingAttachment[]>([]);
  readonly uploading = computed(() => this.items().some(i => i.status === 'uploading'));
  readonly ready = computed(() => this.items().filter(i => i.status === 'ready').map(i => i.attachment!));

  private uploads = new Map<string, Subscription>();
  private counter = 0;

  constructor(
    private service: AttachmentsService,
    private toast: ToastService,
    /** Called when a file has finished uploading, e.g. to read it into a note. */
    private onUploaded?: (item: PendingAttachment) => void
  ) {}

  add(files: FileList | File[]): void {
    const list = Array.from(files);
    const room = MAX_ATTACHMENTS - this.items().length;
    if (list.length > room) {
      this.toast.warning('Too many files', `Up to ${MAX_ATTACHMENTS} files go with one message.`);
    }
    for (const file of list.slice(0, Math.max(room, 0))) {
      const kind = attachmentKindOf(file);
      if (!kind) {
        const heic = /\.(heic|heif)$/i.test(file.name);
        this.toast.warning(`${file.name} was not added`, heic
          ? 'HEIC photos are not supported yet. Pick the photo through the photo library or export it as JPEG.'
          : 'Photos, PDFs and text, Markdown or CSV files work.');
        continue;
      }
      this.start(file, kind);
    }
  }

  remove(localId: string): void {
    this.uploads.get(localId)?.unsubscribe();
    this.uploads.delete(localId);
    const item = this.items().find(i => i.localId === localId);
    if (item?.previewUrl) URL.revokeObjectURL(item.previewUrl);
    this.items.update(list => list.filter(i => i.localId !== localId));
  }

  /** After sending: the files now belong to the message. */
  clear(): void {
    this.items().forEach(i => this.remove(i.localId));
  }

  destroy(): void {
    this.clear();
  }

  private start(file: File, kind: AttachmentKind): void {
    const localId = `file-${Date.now()}-${this.counter++}`;
    const previewUrl = kind === 'IMAGE' ? URL.createObjectURL(file) : null;
    this.items.update(list => [...list, { localId, name: file.name, size: file.size, kind, previewUrl, progress: 0, status: 'uploading' }]);

    prepare(file).then(({ blob, name }) => {
      if (!this.items().some(i => i.localId === localId)) return;
      if (blob.size > MAX_ATTACHMENT_BYTES) {
        this.fail(localId, `Larger than ${MAX_ATTACHMENT_BYTES / 1024 / 1024} MB`);
        return;
      }
      this.patch(localId, { size: blob.size });
      const upload = this.service.upload(blob, name).subscribe({
        next: event => {
          if (event.type === HttpEventType.UploadProgress && event.total) {
            this.patch(localId, { progress: Math.round((event.loaded / event.total) * 100) });
          } else if (event.type === HttpEventType.Response && event.body?.length) {
            const attachment = event.body[0];
            this.patch(localId, { status: 'ready', progress: 100, attachment, name: attachment.fileName });
            const item = this.items().find(i => i.localId === localId);
            if (item) this.onUploaded?.(item);
          }
        },
        error: (err: HttpErrorResponse) => this.fail(localId, err.error?.message || 'Upload failed')
      });
      this.uploads.set(localId, upload);
    });
  }

  note(localId: string, note: string | undefined): void {
    this.patch(localId, { note });
  }

  private fail(localId: string, error: string): void {
    this.patch(localId, { status: 'error', error });
  }

  private patch(localId: string, changes: Partial<PendingAttachment>): void {
    this.items.update(list => list.map(i => (i.localId === localId ? { ...i, ...changes } : i)));
  }
}
