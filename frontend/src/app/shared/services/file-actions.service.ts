import { Injectable, inject } from '@angular/core';
import { Observable, tap } from 'rxjs';
import { DocumentsService } from '../../core/api/documents.service';
import { ToastService } from './toast.service';
import { FileTreeSyncService } from './file-tree-sync.service';

/** The bits of a tree node these actions need — files and folders alike. */
export interface FileTarget {
  path: string;
  name: string;
  isDirectory: boolean;
}

/**
 * Rename / delete / download for a file or folder, shared by the sidebar tree
 * and the folder listing so the two offer the same behaviour rather than two
 * near-identical copies of it. Toasts and file-tree refreshes happen here.
 */
@Injectable({ providedIn: 'root' })
export class FileActionsService {
  private readonly documents = inject(DocumentsService);
  private readonly toast = inject(ToastService);
  private readonly treeSync = inject(FileTreeSyncService);

  /**
   * Renames within the same parent folder. A file keeps its extension even when
   * the user types a bare name, so renaming `notes.md` to `agenda` does not
   * silently turn it into an extensionless file.
   */
  rename(spaceId: string, target: FileTarget, rawName: string): Observable<void> | null {
    let newName = rawName.trim();
    if (!newName || newName === target.name) return null;

    if (!target.isDirectory) {
      const dot = target.name.lastIndexOf('.');
      const extension = dot > 0 ? target.name.substring(dot) : '';
      if (extension && !newName.toLowerCase().endsWith(extension.toLowerCase())) {
        newName += extension;
      }
    }

    const parentPrefix = target.path.includes('/')
      ? target.path.substring(0, target.path.lastIndexOf('/') + 1)
      : '';

    return this.documents.rename(spaceId, target.path, parentPrefix + newName).pipe(
      tap({
        next: () => this.treeSync.notify(spaceId),
        error: (err) => this.toast.error(
          'Rename failed',
          err?.error?.message ?? `Could not rename "${target.name}".`
        )
      })
    );
  }

  delete(spaceId: string, target: FileTarget): Observable<void> {
    return this.documents.deleteDocument(spaceId, target.path).pipe(
      tap({
        next: () => {
          this.toast.success('Deleted', `"${target.name}" has been deleted.`);
          this.treeSync.notify(spaceId);
        },
        error: (err) => this.toast.error(
          'Delete failed',
          err?.error?.message ?? `Could not delete "${target.name}".`
        )
      })
    );
  }

  /** Folders download as a zip; the API serves it from the same file route. */
  downloadFolder(spaceId: string, target: FileTarget): void {
    const link = document.createElement('a');
    link.href = `/api/spaces/${spaceId}/files/${target.path}?download=true`;
    link.download = `${target.name}.zip`;
    link.click();
  }
}
