import { Component, computed, input, output, signal, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DocumentsService, FileNode, TransferMode, TransferResult } from '../../core/api/documents.service';
import { SpacesService, WritableSpace } from '../../core/api/spaces.service';
import { ToastService } from '../services/toast.service';

/** What the dialog carried out, so the caller can report and navigate correctly. */
export interface MoveOutcome {
  mode: TransferMode;
  result: TransferResult;
}

/**
 * Destination picker for moving or copying a document or folder — within the
 * current space or into any other space the user can write to.
 *
 * The folder list belongs to whichever space is selected, so switching spaces
 * fetches that space's tree rather than showing the source space's folders
 * against a foreign destination.
 */
@Component({
  selector: 'app-move-item-dialog',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="modal-overlay" (click)="requestClose()">
      <div class="modal move-modal" (click)="$event.stopPropagation()">
        <div class="modal-header">
          <h2>{{ mode() === 'COPY' ? 'Copy' : 'Move' }} {{ isDirectory() ? 'folder' : 'file' }}</h2>
        </div>

        <div class="modal-body">
          <p class="move-subject">
            <span class="material-icons">{{ isDirectory() ? 'folder' : 'description' }}</span>
            <strong>{{ itemName() }}</strong>
          </p>

          <!-- Move vs copy. Two explicit choices rather than a checkbox: "leave a
               copy here" reads as a modifier on a move, and people then can't say
               which file ends up where. -->
          <div class="move-mode" role="radiogroup" aria-label="Move or copy">
            <button
              type="button"
              class="mode-option"
              role="radio"
              [attr.aria-checked]="mode() === 'MOVE'"
              [class.selected]="mode() === 'MOVE'"
              (click)="mode.set('MOVE')"
            >
              <span class="material-icons">drive_file_move</span>
              <span class="mode-text">
                <span class="mode-title">Move it</span>
                <span class="mode-hint">Nothing stays behind</span>
              </span>
            </button>
            <button
              type="button"
              class="mode-option"
              role="radio"
              [attr.aria-checked]="mode() === 'COPY'"
              [class.selected]="mode() === 'COPY'"
              (click)="mode.set('COPY')"
            >
              <span class="material-icons">content_copy</span>
              <span class="mode-text">
                <span class="mode-title">Copy it</span>
                <span class="mode-hint">The original stays here</span>
              </span>
            </button>
          </div>

          <label class="move-label" for="move-space-select">Destination space</label>
          <select
            id="move-space-select"
            class="move-select"
            [ngModel]="targetSpaceId()"
            (ngModelChange)="onSpaceChange($event)"
            [disabled]="spacesLoading() || busy()"
          >
            @for (space of spaces(); track space.id) {
              <option [value]="space.id" [disabled]="space.inConflict">
                {{ space.fullPath }}{{ space.id === sourceSpaceId() ? ' — this space' : '' }}{{ space.inConflict ? ' (in conflict)' : '' }}
              </option>
            }
          </select>
          @if (spacesLoading()) {
            <p class="move-note">Loading spaces…</p>
          } @else if (spaces().length === 0) {
            <p class="move-note">You don't have write access to any space.</p>
          }

          <label class="move-label" for="move-folder-search">Destination folder</label>
          <div class="move-search-wrap">
            <span class="material-icons move-search-icon">search</span>
            <input
              id="move-folder-search"
              class="move-search"
              type="text"
              placeholder="Search folders…"
              [ngModel]="search()"
              (ngModelChange)="search.set($event)"
            />
          </div>

          <ul class="move-folder-list">
            @if (foldersLoading()) {
              <li class="move-folder-empty">Loading folders…</li>
            } @else {
              @for (folder of filteredFolders(); track folder) {
                <li>
                  <button
                    type="button"
                    class="move-folder-option"
                    [class.selected]="folder === targetFolder()"
                    [disabled]="isBlockedFolder(folder)"
                    [title]="isBlockedFolder(folder) ? 'A folder can\\'t go inside itself' : folder || 'Space root'"
                    (click)="targetFolder.set(folder)"
                  >
                    <span class="material-icons opt-icon">{{ folder ? 'folder' : 'home' }}</span>
                    <span class="move-folder-label">{{ folder || '(space root)' }}</span>
                    @if (folder === targetFolder()) {
                      <span class="material-icons opt-check">check</span>
                    }
                  </button>
                </li>
              } @empty {
                <li class="move-folder-empty">No matching folders</li>
              }
            }
          </ul>

          <p class="move-destination">
            {{ mode() === 'COPY' ? 'Copy to' : 'Move to' }}
            <code>{{ destinationLabel() }}</code>
          </p>
          @if (isNoop()) {
            <p class="move-note warn">That's where it already is.</p>
          }
        </div>

        <div class="modal-footer">
          <button type="button" class="btn btn-secondary" (click)="requestClose()" [disabled]="busy()">Cancel</button>
          <button
            type="button"
            class="btn btn-primary"
            (click)="confirm()"
            [disabled]="busy() || isNoop() || !targetSpaceId() || isBlockedFolder(targetFolder())"
          >
            {{ busy() ? 'Working…' : (mode() === 'COPY' ? 'Copy' : 'Move') }}
          </button>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .move-modal { width: min(520px, 92vw); }

    .move-subject {
      display: flex;
      align-items: center;
      gap: 8px;
      margin: 0 0 var(--spacing-md);
      color: var(--text-primary);

      .material-icons { font-size: 20px; color: var(--text-muted); }
      strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    }

    .move-mode {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 8px;
    }

    .mode-option {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 10px 12px;
      border: 1px solid var(--border);
      border-radius: var(--radius-md);
      background: var(--surface);
      color: var(--text-primary);
      text-align: left;
      cursor: pointer;

      .material-icons { font-size: 20px; color: var(--text-muted); flex-shrink: 0; }

      &:hover { border-color: var(--primary); }

      &.selected {
        border-color: var(--primary);
        background: var(--background-darker);

        .material-icons { color: var(--primary); }
      }
    }

    .mode-text { display: flex; flex-direction: column; min-width: 0; }
    .mode-title { font-size: 13.5px; font-weight: 600; }
    .mode-hint { font-size: 12px; color: var(--text-muted); }

    .move-label {
      display: block;
      margin: var(--spacing-md) 0 4px;
      font-size: 12px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      color: var(--text-muted);
    }

    .move-select {
      width: 100%;
      padding: var(--spacing-sm);
      border: 1px solid var(--border);
      border-radius: var(--radius-md);
      background: var(--surface);
      color: var(--text-primary);
      font-size: 14px;

      &:focus { outline: none; border-color: var(--primary); }
    }

    .move-search-wrap { position: relative; }

    .move-search-icon {
      position: absolute;
      left: 10px;
      top: 50%;
      transform: translateY(-50%);
      font-size: 18px;
      color: var(--text-muted);
      pointer-events: none;
    }

    .move-search {
      width: 100%;
      padding: var(--spacing-sm) var(--spacing-sm) var(--spacing-sm) 34px;
      border: 1px solid var(--border);
      border-radius: var(--radius-md);
      background: var(--surface);
      color: var(--text-primary);
      font-size: 14px;

      &:focus { outline: none; border-color: var(--primary); }
    }

    .move-folder-list {
      list-style: none;
      margin: var(--spacing-sm) 0 0;
      padding: 4px;
      max-height: 220px;
      overflow-y: auto;
      border: 1px solid var(--border);
      border-radius: var(--radius-md);
      background: var(--surface);
    }

    .move-folder-option {
      display: flex;
      align-items: center;
      gap: 8px;
      width: 100%;
      padding: 7px 10px;
      border: none;
      border-radius: var(--radius-sm);
      background: none;
      color: var(--text-primary);
      font-size: 13.5px;
      text-align: left;
      cursor: pointer;

      .opt-icon { font-size: 18px; color: var(--text-muted); flex-shrink: 0; }

      .move-folder-label {
        flex: 1;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .opt-check { font-size: 18px; color: var(--primary); flex-shrink: 0; }

      &:hover:not(:disabled) { background: var(--background); }

      &:disabled { opacity: 0.4; cursor: not-allowed; }

      &.selected {
        background: var(--background-darker);
        font-weight: 600;

        .opt-icon { color: var(--primary); }
      }
    }

    .move-folder-empty {
      padding: 12px 10px;
      color: var(--text-muted);
      font-size: 13px;
      text-align: center;
    }

    .move-destination {
      margin: var(--spacing-md) 0 0;
      font-size: 13px;
      color: var(--text-muted);

      code {
        color: var(--text-primary);
        word-break: break-all;
      }
    }

    .move-note {
      margin: 6px 0 0;
      font-size: 12.5px;
      color: var(--text-muted);

      &.warn { color: var(--warning, #b07d2a); }
    }
  `]
})
export class MoveItemDialogComponent implements OnInit {
  /** The item being moved, and the space it currently lives in. */
  node = input.required<FileNode>();
  sourceSpaceId = input.required<string>();

  readonly done = output<MoveOutcome>();
  readonly cancelled = output<void>();

  spaces = signal<WritableSpace[]>([]);
  spacesLoading = signal(true);
  foldersLoading = signal(false);
  busy = signal(false);

  mode = signal<TransferMode>('MOVE');
  targetSpaceId = signal('');
  targetFolder = signal('');
  search = signal('');

  /** Folder paths of the selected destination space, '' (root) included. */
  private folders = signal<string[]>([]);

  itemName = computed(() => this.node().name);
  isDirectory = computed(() => this.node().isDirectory);

  constructor(
    private documentsService: DocumentsService,
    private spacesService: SpacesService,
    private toastService: ToastService
  ) {}

  ngOnInit(): void {
    this.targetSpaceId.set(this.sourceSpaceId());
    this.targetFolder.set(this.parentFolderOf(this.node().path));

    this.spacesService.getWritableSpaces().subscribe({
      next: (spaces) => {
        this.spaces.set(spaces);
        this.spacesLoading.set(false);
        // The source space may be read-only for this user on a copy — then it
        // isn't in the list and the picker has to start somewhere real.
        if (!spaces.some(s => s.id === this.targetSpaceId())) {
          const first = spaces.find(s => !s.inConflict);
          this.targetSpaceId.set(first?.id ?? '');
          this.targetFolder.set('');
        }
        this.loadFolders();
      },
      error: () => {
        this.spacesLoading.set(false);
        this.toastService.error('Move', 'Could not load the list of spaces.');
      }
    });
  }

  filteredFolders = computed<string[]>(() => {
    const query = this.search().toLowerCase().trim();
    const all = this.folders();
    if (!query) return all;
    return all.filter(f => (f || 'space root').toLowerCase().includes(query));
  });

  /**
   * A folder can't be dropped into itself or one of its own descendants — only
   * meaningful when the destination space is the one it already lives in.
   */
  isBlockedFolder(folder: string): boolean {
    if (!this.isDirectory()) return false;
    if (this.targetSpaceId() !== this.sourceSpaceId()) return false;
    const own = this.node().path;
    return folder === own || folder.startsWith(`${own}/`);
  }

  isNoop = computed(() =>
    this.mode() === 'MOVE' &&
    this.targetSpaceId() === this.sourceSpaceId() &&
    this.targetFolder() === this.parentFolderOf(this.node().path)
  );

  destinationLabel = computed(() => {
    const space = this.spaces().find(s => s.id === this.targetSpaceId());
    const folder = this.targetFolder();
    const path = folder ? `${folder}/${this.itemName()}` : this.itemName();
    return space ? `${space.fullPath} / ${path}` : path;
  });

  onSpaceChange(spaceId: string): void {
    this.targetSpaceId.set(spaceId);
    this.targetFolder.set('');
    this.search.set('');
    this.loadFolders();
  }

  private loadFolders(): void {
    const spaceId = this.targetSpaceId();
    if (!spaceId) {
      this.folders.set(['']);
      return;
    }
    this.foldersLoading.set(true);
    this.documentsService.getFileTree(spaceId).subscribe({
      next: (tree) => {
        this.folders.set(['', ...this.collectFolders(tree)]);
        this.foldersLoading.set(false);
      },
      error: () => {
        this.folders.set(['']);
        this.foldersLoading.set(false);
        this.toastService.error('Move', "Could not read that space's folders.");
      }
    });
  }

  private collectFolders(nodes: FileNode[]): string[] {
    const out: string[] = [];
    const walk = (list: FileNode[]): void => {
      for (const n of list) {
        if (!n.isDirectory) continue;
        out.push(n.path);
        if (n.children) walk(n.children);
      }
    };
    walk(nodes);
    return out.sort((a, b) => a.localeCompare(b));
  }

  private parentFolderOf(path: string): string {
    const cut = path.lastIndexOf('/');
    return cut < 0 ? '' : path.substring(0, cut);
  }

  confirm(): void {
    if (this.busy() || this.isNoop()) return;
    this.busy.set(true);
    this.documentsService.transfer(this.sourceSpaceId(), {
      sourcePath: this.node().path,
      targetSpaceId: this.targetSpaceId(),
      targetFolder: this.targetFolder(),
      mode: this.mode()
    }).subscribe({
      next: (result) => {
        this.busy.set(false);
        this.done.emit({ mode: this.mode(), result });
      },
      error: (err) => {
        this.busy.set(false);
        this.toastService.error(
          this.mode() === 'COPY' ? 'Copy failed' : 'Move failed',
          err?.error?.message ?? 'Could not complete that.'
        );
      }
    });
  }

  requestClose(): void {
    if (this.busy()) return;
    this.cancelled.emit();
  }
}
