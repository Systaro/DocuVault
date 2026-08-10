import { Injectable, inject } from '@angular/core';
import { HttpEventType } from '@angular/common/http';
import { EMPTY, Observable, concat, defer, from, of, throwError } from 'rxjs';
import { catchError, concatMap, filter, ignoreElements, map } from 'rxjs/operators';
import { DocumentsService, UploadItem, UploadedFile } from '../../core/api/documents.service';
import { ToastService } from './toast.service';
import { FileTreeSyncService } from './file-tree-sync.service';

/**
 * Mirrors `spring.servlet.multipart` in `backend/src/main/resources/application.yml`
 * (max-file-size 50MB, max-request-size 100MB) and nginx's `client_max_body_size 100M`.
 * Chunks stay well under the request cap so multipart part overhead can't push a
 * batch over it, and a chunk is also capped by file count so a folder of many tiny
 * files still reports progress instead of going quiet.
 */
const MAX_FILE_BYTES = 50 * 1024 * 1024;
const MAX_CHUNK_BYTES = 40 * 1024 * 1024;
const MAX_CHUNK_FILES = 50;

/** OS metadata that no one means to upload when they drag a folder in. */
const IGNORED_NAMES = new Set(['.DS_Store', 'Thumbs.db', 'desktop.ini']);

export interface SkippedFile {
  name: string;
  reason: 'ignored' | 'too-large';
}

/** The outcome of turning a drop or a file picker into an upload batch. */
export interface UploadSelection {
  items: UploadItem[];
  skipped: SkippedFile[];
}

export interface BulkUploadProgress {
  /** Files confirmed written by the backend so far. */
  uploadedFiles: number;
  totalFiles: number;
  /** 0–100, derived from bytes sent, so it moves smoothly within a chunk. */
  percent: number;
  done: boolean;
  uploaded: UploadedFile[];
}

/**
 * Turns a drop or a file-picker selection into an upload batch and ships it.
 *
 * Dropping a folder is the reason this exists: `DataTransfer.files` flattens a
 * dropped directory to nothing useful, so directories are walked through the
 * entries API and every file keeps the path that recreates the tree under the
 * destination folder.
 *
 * Batches are uploaded in sequential chunks bounded by size and count, and only
 * the last chunk commits — a 500-file folder becomes one Git commit, not 500.
 */
@Injectable({ providedIn: 'root' })
export class BulkUploadService {
  private readonly documents = inject(DocumentsService);
  private readonly toast = inject(ToastService);
  private readonly treeSync = inject(FileTreeSyncService);

  /**
   * Collects a drop into an upload batch, recursing into any dropped folders.
   *
   * Must be called synchronously from the `drop` handler: the browser empties
   * `DataTransfer.items` as soon as the event finishes dispatching, so the
   * entries are captured up front and only the walk itself is async.
   */
  collectFromDrop(dataTransfer: DataTransfer | null): Promise<UploadSelection> {
    if (!dataTransfer) return Promise.resolve({ items: [], skipped: [] });

    const entries = Array.from(dataTransfer.items ?? [])
      .filter(item => item.kind === 'file')
      .map(item => item.webkitGetAsEntry?.() ?? null)
      .filter((entry): entry is FileSystemEntry => !!entry);

    if (!entries.length) {
      // No entries API (or a drag that carries plain files only) — flat list.
      return Promise.resolve(this.select(
        Array.from(dataTransfer.files ?? []).map(file => ({ file, relativePath: file.name }))
      ));
    }

    return this.walk(entries).then(items => this.select(items));
  }

  /**
   * Collects a file-input selection. `webkitRelativePath` is populated for
   * `webkitdirectory` inputs, which is what preserves a picked folder's tree.
   */
  collectFromInput(files: FileList | null): UploadSelection {
    return this.select(Array.from(files ?? []).map(file => ({
      file,
      relativePath: file.webkitRelativePath || file.name
    })));
  }

  /**
   * Uploads a batch into `folder`, reporting progress, then announces the result
   * by toast and tells every view of the space to reload its file tree.
   */
  uploadTo(spaceId: string, selection: UploadSelection, folder: string): Observable<BulkUploadProgress> {
    const destination = folder || 'space root';
    const tooLarge = selection.skipped.filter(s => s.reason === 'too-large');

    if (!selection.items.length) {
      if (tooLarge.length) {
        this.toast.error('Nothing uploaded', this.tooLargeMessage(tooLarge));
      }
      return of({ uploadedFiles: 0, totalFiles: 0, percent: 100, done: true, uploaded: [] });
    }

    return this.upload(spaceId, selection.items, folder).pipe(
      map(progress => {
        if (!progress.done) return progress;

        const count = progress.uploaded.length;
        // The server answers 200 with an empty list when it accepted the request
        // but stored nothing (an unwritable repo, say). Reporting that as a
        // success would claim an upload that did not happen.
        if (!count) {
          this.toast.error(
            'Nothing was uploaded',
            `The server stored none of the ${selection.items.length} file(s) sent to ${destination}.`
          );
          return progress;
        }

        const detail = tooLarge.length
          ? `${this.summarise(progress.uploaded)} → ${destination}. ${this.tooLargeMessage(tooLarge)}`
          : `${this.summarise(progress.uploaded)} → ${destination}`;
        this.toast.success(`${count} file${count === 1 ? '' : 's'} uploaded`, detail);
        this.treeSync.notify(spaceId);
        return progress;
      }),
      catchError(error => {
        // Chunks that already landed stay on disk; the finalize call inside
        // upload() has committed them, so report what actually made it.
        this.treeSync.notify(spaceId);
        this.toast.error(
          'Upload failed',
          error?.error?.message ?? `Could not upload all files to ${destination}.`
        );
        return throwError(() => error);
      })
    );
  }

  /** Transport only — sequential chunks, aggregated progress, one final commit. */
  private upload(spaceId: string, items: UploadItem[], folder: string): Observable<BulkUploadProgress> {
    const chunks = this.chunk(items);
    const totalFiles = items.length;
    const totalBytes = this.bytesOf(items);
    const commitMessage = this.commitMessage(items, folder);

    let sentBytes = 0;
    let sentFiles = 0;
    const uploaded: UploadedFile[] = [];

    const report = (bytes: number, done: boolean): BulkUploadProgress => ({
      uploadedFiles: sentFiles,
      totalFiles,
      percent: totalBytes ? Math.min(100, Math.round((bytes / totalBytes) * 100)) : 100,
      done,
      uploaded: [...uploaded]
    });

    const transfer = from(chunks).pipe(
      concatMap((chunk, index) => {
        const chunkBytes = this.bytesOf(chunk);
        const last = index === chunks.length - 1;
        return this.documents.uploadFiles(spaceId, chunk, {
          folder,
          commit: last,
          commitMessage: last ? commitMessage : undefined
        }).pipe(
          map(event => {
            if (event.type === HttpEventType.UploadProgress) {
              return report(sentBytes + Math.min(event.loaded, chunkBytes), false);
            }
            if (event.type === HttpEventType.Response) {
              sentBytes += chunkBytes;
              sentFiles += chunk.length;
              uploaded.push(...(event.body ?? []));
              return report(sentBytes, false);
            }
            return null;
          }),
          filter((progress): progress is BulkUploadProgress => progress !== null),
          catchError(error => {
            // Everything before this chunk is written but uncommitted, because
            // only the last chunk was going to commit. Close the batch so the
            // files that did land are in Git rather than sitting as pending
            // working-tree changes.
            const salvage = uploaded.length
              ? this.documents.uploadFiles(spaceId, [], {
                  folder,
                  commit: true,
                  commitMessage: this.commitMessage(items, folder, uploaded.length)
                }).pipe(catchError(() => EMPTY))
              : EMPTY;
            return concat(salvage.pipe(ignoreElements()), throwError(() => error));
          })
        );
      })
    );

    return concat(transfer, defer(() => of(report(totalBytes, true))));
  }

  /** Drops OS junk and Git internals, and holds back files the server would reject. */
  private select(items: UploadItem[]): UploadSelection {
    const kept: UploadItem[] = [];
    const skipped: SkippedFile[] = [];

    for (const item of items) {
      const segments = item.relativePath.split('/');
      const name = segments[segments.length - 1];
      if (IGNORED_NAMES.has(name) || segments.includes('.git')) {
        skipped.push({ name, reason: 'ignored' });
        continue;
      }
      if (item.file.size > MAX_FILE_BYTES) {
        skipped.push({ name, reason: 'too-large' });
        continue;
      }
      kept.push(item);
    }

    return { items: kept, skipped };
  }

  private chunk(items: UploadItem[]): UploadItem[][] {
    const chunks: UploadItem[][] = [];
    let current: UploadItem[] = [];
    let currentBytes = 0;

    for (const item of items) {
      const wouldExceed = current.length >= MAX_CHUNK_FILES
        || (current.length > 0 && currentBytes + item.file.size > MAX_CHUNK_BYTES);
      if (wouldExceed) {
        chunks.push(current);
        current = [];
        currentBytes = 0;
      }
      current.push(item);
      currentBytes += item.file.size;
    }
    if (current.length) chunks.push(current);

    return chunks;
  }

  private bytesOf(items: UploadItem[]): number {
    return items.reduce((sum, item) => sum + item.file.size, 0);
  }

  /** Recursively resolves dropped entries into files that keep their subpaths. */
  private async walk(entries: FileSystemEntry[]): Promise<UploadItem[]> {
    const items: UploadItem[] = [];

    const visit = async (entry: FileSystemEntry, prefix: string): Promise<void> => {
      if (entry.isFile) {
        const file = await this.fileOf(entry as FileSystemFileEntry);
        if (file) items.push({ file, relativePath: `${prefix}${entry.name}` });
        return;
      }
      if (entry.isDirectory) {
        const children = await this.childrenOf(entry as FileSystemDirectoryEntry);
        for (const child of children) {
          await visit(child, `${prefix}${entry.name}/`);
        }
      }
    };

    for (const entry of entries) {
      await visit(entry, '');
    }
    return items;
  }

  private fileOf(entry: FileSystemFileEntry): Promise<File | null> {
    return new Promise(resolve => entry.file(resolve, () => resolve(null)));
  }

  /** `readEntries` yields at most 100 entries per call, so it has to be drained. */
  private async childrenOf(directory: FileSystemDirectoryEntry): Promise<FileSystemEntry[]> {
    const reader = directory.createReader();
    const all: FileSystemEntry[] = [];

    for (;;) {
      const batch = await new Promise<FileSystemEntry[]>(resolve =>
        reader.readEntries(resolve, () => resolve([]))
      );
      if (!batch.length) return all;
      all.push(...batch);
    }
  }

  private commitMessage(items: UploadItem[], folder: string, count = items.length): string {
    const where = folder ? ` to ${folder}` : '';
    const folders = new Set(
      items.map(i => i.relativePath).filter(p => p.includes('/')).map(p => p.split('/')[0])
    );
    if (folders.size === 1 && count > 1) {
      return `Upload folder ${[...folders][0]} (${count} file(s))${where}`;
    }
    return `Upload ${count} file(s)${where}`;
  }

  /** Names a couple of uploads and counts the rest — a folder upload has too many to list. */
  private summarise(uploaded: UploadedFile[]): string {
    const shown = uploaded.slice(0, 3).map(f => f.name).join(', ');
    const rest = uploaded.length - Math.min(uploaded.length, 3);
    return rest > 0 ? `${shown} and ${rest} more` : shown;
  }

  private tooLargeMessage(tooLarge: SkippedFile[]): string {
    const limit = MAX_FILE_BYTES / (1024 * 1024);
    const names = tooLarge.slice(0, 3).map(f => f.name).join(', ');
    const rest = tooLarge.length - Math.min(tooLarge.length, 3);
    const listed = rest > 0 ? `${names} and ${rest} more` : names;
    return `Skipped ${tooLarge.length} file(s) over ${limit} MB: ${listed}.`;
  }
}
