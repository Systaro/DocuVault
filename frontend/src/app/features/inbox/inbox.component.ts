import { Component, OnInit, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { InboxService, InboxNote, AiSuggestion } from '../../core/api/inbox.service';
import { SpacesService } from '../../core/api/spaces.service';
import { ToastService } from '../../shared/services/toast.service';
import { DiffViewComponent } from './diff-view.component';
import { MeetingInviteModalComponent } from './meeting-invite-modal.component';

@Component({
  selector: 'app-inbox',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, DiffViewComponent, MeetingInviteModalComponent],
  template: `
    <div class="inbox-container">
      <!-- Header -->
      <div class="inbox-header">
        <h1>
          <span class="material-icons">move_to_inbox</span>
          Inbox
        </h1>
        <div class="header-right">
          <button class="btn btn-secondary btn-sm" (click)="showMeetingModal.set(true)">
            <span class="material-icons">graphic_eq</span>
            Meeting transkribieren
          </button>
          <span class="notes-meta">{{ activeNotes().length }} {{ activeTab() === 'unsorted' ? 'unsorted' : 'filed' }}</span>
        </div>
      </div>

      <!-- Tabs -->
      <div class="inbox-tabs">
        <button class="tab" [class.active]="activeTab() === 'unsorted'" (click)="switchTab('unsorted')">
          Unsorted
          @if (unsortedNotes().length > 0) {
            <span class="tab-badge">{{ unsortedNotes().length }}</span>
          }
        </button>
        <button class="tab" [class.active]="activeTab() === 'filed'" (click)="switchTab('filed')">
          Filed
          @if (filedNotes().length > 0) {
            <span class="tab-badge tab-badge-neutral">{{ filedNotes().length }}</span>
          }
        </button>
      </div>

      <!-- Unsorted split view -->
      @if (activeTab() === 'unsorted') {
        <div class="inbox-split">
          <!-- Left: note list -->
          <div class="note-list-panel">
            @if (loading()) {
              <div class="empty-state">
                <span class="material-icons spinning">refresh</span>
                Loading...
              </div>
            } @else if (unsortedNotes().length === 0) {
              <div class="empty-state">
                <span class="material-icons">check_circle</span>
                <p>All caught up! No unsorted notes.</p>
              </div>
            } @else {
              @for (note of unsortedNotes(); track note.id) {
                <div
                  class="note-card"
                  [class.selected]="selectedNote()?.id === note.id"
                  (click)="selectNote(note)"
                >
                  <div class="note-card-meta">
                    <div class="avatar-sm">{{ getInitials(note.authorName) }}</div>
                    <span class="note-author">{{ note.authorName }}</span>
                    <span class="note-time">{{ note.createdAt | date:'HH:mm' }}</span>
                  </div>
                  <div class="note-preview" [innerHTML]="note.content | slice:0:200"></div>
                </div>
              }
            }
          </div>

          <!-- Right: suggestion panel -->
          <div class="suggestion-panel">
            @if (!selectedNote()) {
              <div class="empty-state">
                <span class="material-icons">arrow_back</span>
                <p>Select a note to see AI filing suggestion</p>
              </div>
            } @else {
              <div class="suggestion-content">
                <!-- Note content -->
                <div class="note-full-content" [innerHTML]="selectedNote()!.content"></div>

                <div class="suggestion-divider"></div>

                <!-- AI suggestion -->
                @if (suggestingNote()) {
                  <div class="suggestion-loading">
                    <span class="material-icons spinning">auto_awesome</span>
                    Analysing note...
                  </div>
                } @else if (currentSuggestion()) {
                  @if (currentSuggestion()!.error) {
                    <div class="suggestion-error">
                      <span class="material-icons">warning</span>
                      {{ currentSuggestion()!.error }}
                    </div>
                  } @else {
                    <div class="suggestion-box">
                      <div class="suggestion-header">
                        <span class="material-icons ai-icon">auto_awesome</span>
                        <span class="suggestion-label">AI Suggestion</span>
                        <div class="confidence-pill" [class.high]="currentSuggestion()!.confidence >= 0.7" [class.low]="currentSuggestion()!.confidence < 0.5">
                          {{ (currentSuggestion()!.confidence * 100).toFixed(0) }}% confident
                        </div>
                      </div>

                      <div class="suggestion-destination">
                        <span class="material-icons">subdirectory_arrow_right</span>
                        @if (currentSuggestion()!.action === 'APPEND_TO_DOCUMENT') {
                          <span class="dest-path">{{ currentSuggestion()!.documentPath }}</span>
                          <span class="dest-action">append</span>
                        } @else {
                          <span class="dest-path">{{ currentSuggestion()!.newDocumentPath }}</span>
                          <span class="dest-action">create new</span>
                        }
                      </div>

                      <p class="suggestion-explanation">{{ currentSuggestion()!.explanation }}</p>

                      @if (currentSuggestion()!.mergedContent) {
                        <button class="btn btn-ghost btn-sm" (click)="showDiff.set(true)">
                          <span class="material-icons">compare</span>
                          Preview changes
                        </button>
                      }
                    </div>
                  }
                } @else {
                  <div class="suggestion-empty">
                    <button class="btn btn-secondary btn-sm" (click)="requestSuggestion()">
                      <span class="material-icons">auto_awesome</span>
                      Generate AI suggestion
                    </button>
                  </div>
                }

                <!-- Actions -->
                <div class="action-row">
                  <button
                    class="btn btn-primary"
                    [disabled]="filing() || !currentSuggestion() || !!currentSuggestion()!.error"
                    (click)="fileWithSuggestion()"
                  >
                    <span class="material-icons">check</span>
                    {{ filing() ? 'Filing...' : 'File here' }}
                  </button>

                  <button
                    class="btn btn-secondary"
                    [disabled]="filing() || !currentSuggestion() || !!currentSuggestion()!.error"
                    (click)="showDontAskDialog.set(true)"
                    title="Save a routing rule and file"
                  >
                    <span class="material-icons">rule</span>
                    Don't ask next time
                  </button>

                  <button class="btn btn-ghost" [disabled]="filing()" (click)="dismiss()">
                    <span class="material-icons">close</span>
                    Dismiss
                  </button>
                </div>
              </div>
            }
          </div>
        </div>
      }

      <!-- Filed list -->
      @if (activeTab() === 'filed') {
        <div class="filed-list">
          @if (loading()) {
            <div class="empty-state">
              <span class="material-icons spinning">refresh</span>
              Loading...
            </div>
          } @else if (filedNotes().length === 0) {
            <div class="empty-state">
              <span class="material-icons">inbox</span>
              <p>No filed notes yet.</p>
            </div>
          } @else {
            @for (note of filedNotes(); track note.id) {
              <div class="filed-card">
                <div class="filed-card-avatar">
                  <div class="avatar-sm">{{ getInitials(note.authorName) }}</div>
                </div>
                <div class="filed-card-body">
                  <div class="filed-card-header">
                    <span class="filed-author">{{ note.authorName }}</span>
                    <span class="filed-time">{{ note.createdAt | date:'MMM d, HH:mm' }}</span>
                  </div>
                  <div class="filed-preview" [innerHTML]="note.content | slice:0:300"></div>
                  <div class="filed-meta">
                    <span class="filed-destination">
                      <span class="material-icons">subdirectory_arrow_right</span>
                      {{ note.filedToDocumentPath }}
                    </span>
                    @if (note.autoFiled) {
                      <span class="filed-by auto">
                        <span class="material-icons">auto_awesome</span>
                        Auto-filed by rule
                      </span>
                    } @else if (note.filedByName) {
                      <span class="filed-by">
                        <span class="material-icons">person</span>
                        Filed by {{ note.filedByName }}
                        @if (note.filedAt) {
                          · {{ note.filedAt | date:'HH:mm' }}
                        }
                      </span>
                    }
                  </div>
                </div>
              </div>
            }
          }
        </div>
      }
    </div>

    <!-- Diff preview modal -->
    @if (showDiff() && currentSuggestion()) {
      <app-diff-view
        [original]="currentSuggestion()!.originalContent || ''"
        [merged]="currentSuggestion()!.mergedContent || ''"
        [documentPath]="currentSuggestion()!.documentPath || currentSuggestion()!.newDocumentPath || ''"
        (accept)="acceptDiff()"
        (close)="showDiff.set(false)"
      />
    }

    <!-- Meeting transcription invites -->
    @if (showMeetingModal()) {
      <app-meeting-invite-modal [spaceId]="spaceId" (close)="showMeetingModal.set(false)" />
    }

    <!-- Don't ask next time dialog -->
    @if (showDontAskDialog()) {
      <div class="modal-overlay" (click)="showDontAskDialog.set(false)">
        <div class="modal-box" (click)="$event.stopPropagation()">
          <h3>Save routing rule</h3>
          <p>We'll file this note now and automatically route similar notes in future.</p>
          <div class="form-group">
            <label>Match notes containing:</label>
            <input type="text" class="input" [(ngModel)]="ruleConditionInput" placeholder="e.g. #bug, meeting notes..." />
          </div>
          <div class="modal-actions">
            <button class="btn btn-secondary" (click)="showDontAskDialog.set(false)">Cancel</button>
            <button class="btn btn-primary" (click)="fileAndSaveRule()">
              File & Save Rule
            </button>
          </div>
        </div>
      </div>
    }
  `,
  styles: [`
    .inbox-container {
      display: flex;
      flex-direction: column;
      height: 100%;
      background: var(--background);
    }

    .inbox-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 24px 32px 0;

      h1 {
        display: flex;
        align-items: center;
        gap: 10px;
        font-size: 22px;
        font-weight: 700;
        color: var(--text-primary);

        .material-icons { color: var(--primary); }
      }

      .notes-meta {
        font-size: 13px;
        color: var(--text-muted);
      }

      .header-right {
        display: flex;
        align-items: center;
        gap: 12px;
      }
    }

    .inbox-tabs {
      display: flex;
      gap: 4px;
      padding: 16px 32px 0;
      border-bottom: 1px solid var(--border);
      margin-bottom: 0;
    }

    .tab {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 8px 16px;
      border: none;
      background: transparent;
      cursor: pointer;
      font-size: 14px;
      font-weight: 500;
      color: var(--text-secondary);
      border-bottom: 2px solid transparent;
      margin-bottom: -1px;
      transition: all var(--transition);
      font-family: var(--font-body, inherit);

      &.active {
        color: var(--primary-dark);
        border-bottom-color: var(--primary);
      }

      &:hover:not(.active) { color: var(--text-primary); }
    }

    .tab-badge {
      background: var(--primary);
      color: white;
      border-radius: 999px;
      padding: 1px 7px;
      font-size: 11px;
      font-weight: 600;
    }

    .tab-badge-neutral {
      background: var(--surface-raised, var(--surface));
      color: var(--text-secondary);
      border: 1px solid var(--border);
    }

    /* Unsorted split */
    .inbox-split {
      display: flex;
      flex: 1;
      overflow: hidden;
    }

    .note-list-panel {
      width: 340px;
      flex-shrink: 0;
      border-right: 1px solid var(--border);
      overflow-y: auto;
      padding: 12px;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .note-card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius-lg, 8px);
      padding: 14px 16px;
      cursor: pointer;
      transition: all var(--transition);

      &:hover { border-color: var(--primary); }
      &.selected {
        border-color: var(--primary);
        background: rgba(111, 179, 184, 0.06);
      }
    }

    .note-card-meta {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 8px;
    }

    .avatar-sm {
      width: 26px;
      height: 26px;
      border-radius: 50%;
      background: var(--primary);
      color: white;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 10px;
      font-weight: 700;
      flex-shrink: 0;
    }

    .note-author { font-size: 12px; font-weight: 600; color: var(--text-primary); }
    .note-time { font-size: 11px; color: var(--text-muted); margin-left: auto; }

    .note-preview {
      font-size: 12px;
      color: var(--text-secondary);
      line-height: 1.5;
      display: -webkit-box;
      -webkit-line-clamp: 3;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }

    /* Suggestion panel */
    .suggestion-panel {
      flex: 1;
      overflow-y: auto;
      padding: 20px 24px;
    }

    .suggestion-content {
      display: flex;
      flex-direction: column;
      gap: 16px;
    }

    .note-full-content {
      font-size: 14px;
      color: var(--text-primary);
      line-height: 1.7;
    }

    .suggestion-divider {
      height: 1px;
      background: var(--border);
    }

    .suggestion-loading {
      display: flex;
      align-items: center;
      gap: 10px;
      color: var(--primary);
      font-size: 14px;
    }

    .suggestion-error {
      display: flex;
      align-items: center;
      gap: 8px;
      color: #dc2626;
      font-size: 14px;
      background: rgba(220, 38, 38, 0.08);
      padding: 10px 14px;
      border-radius: 8px;
    }

    .suggestion-box {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius-lg, 8px);
      padding: 16px;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }

    .suggestion-header {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .ai-icon { font-size: 16px; color: var(--primary); }
    .suggestion-label { font-size: 13px; font-weight: 600; color: var(--text-primary); flex: 1; }

    .confidence-pill {
      font-size: 11px;
      font-weight: 600;
      padding: 2px 8px;
      border-radius: 999px;
      background: rgba(111, 179, 184, 0.15);
      color: var(--primary-dark);

      &.high { background: rgba(34, 197, 94, 0.12); color: #15803d; }
      &.low { background: rgba(245, 158, 11, 0.12); color: #b45309; }
    }

    .suggestion-destination {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 13px;

      .material-icons { font-size: 16px; color: var(--primary); }
      .dest-path { color: var(--primary); font-weight: 500; }
      .dest-action { color: var(--text-muted); font-size: 11px; }
    }

    .suggestion-explanation {
      font-size: 13px;
      color: var(--text-secondary);
      line-height: 1.5;
      margin: 0;
    }

    .suggestion-empty {
      display: flex;
      justify-content: center;
    }

    .action-row {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
    }

    /* Filed list */
    .filed-list {
      flex: 1;
      overflow-y: auto;
      padding: 16px 32px;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }

    .filed-card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius-lg, 8px);
      padding: 16px 18px;
      display: flex;
      gap: 12px;
      transition: all var(--transition);

      &:hover { border-color: rgba(111, 179, 184, 0.3); }
    }

    .filed-card-body { flex: 1; min-width: 0; }
    .filed-card-header { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
    .filed-author { font-size: 13px; font-weight: 600; color: var(--text-primary); }
    .filed-time { font-size: 11px; color: var(--text-muted); }

    .filed-preview {
      font-size: 13px;
      color: var(--text-secondary);
      line-height: 1.5;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
      margin-bottom: 8px;
    }

    .filed-meta {
      display: flex;
      align-items: center;
      gap: 14px;
      flex-wrap: wrap;
    }

    .filed-destination {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      font-size: 12px;
      color: var(--primary);
      font-weight: 500;
      background: rgba(111, 179, 184, 0.1);
      padding: 2px 8px;
      border-radius: 999px;

      .material-icons { font-size: 13px; }
    }

    .filed-by {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      font-size: 11px;
      color: var(--text-muted);

      .material-icons { font-size: 13px; }

      &.auto { color: var(--primary-dark); }
    }

    /* Empty state */
    .empty-state {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 10px;
      padding: 48px 24px;
      color: var(--text-muted);
      font-size: 14px;
      text-align: center;

      .material-icons { font-size: 36px; opacity: 0.5; }
      p { margin: 0; }
    }

    .spinning {
      animation: spin 1s linear infinite;
    }
    @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }

    /* Don't ask next time modal */
    .modal-overlay {
      position: fixed;
      inset: 0;
      background: rgba(0,0,0,0.5);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 300;
    }

    .modal-box {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius-xl, 12px);
      padding: 24px;
      width: 420px;
      max-width: 95vw;
      display: flex;
      flex-direction: column;
      gap: 14px;

      h3 { font-size: 16px; font-weight: 600; color: var(--text-primary); margin: 0; }
      p { font-size: 14px; color: var(--text-secondary); margin: 0; }
    }

    .form-group {
      display: flex;
      flex-direction: column;
      gap: 6px;

      label { font-size: 12px; font-weight: 500; color: var(--text-secondary); }
    }

    .modal-actions {
      display: flex;
      justify-content: flex-end;
      gap: 8px;
    }
  `]
})
export class InboxComponent implements OnInit {
  spaceId = '';

  activeTab = signal<'unsorted' | 'filed'>('unsorted');
  loading = signal(false);
  filing = signal(false);
  suggestingNote = signal(false);

  unsortedNotes = signal<InboxNote[]>([]);
  filedNotes = signal<InboxNote[]>([]);
  selectedNote = signal<InboxNote | null>(null);
  currentSuggestion = signal<AiSuggestion | null>(null);

  showDiff = signal(false);
  showDontAskDialog = signal(false);
  showMeetingModal = signal(false);
  ruleConditionInput = '';

  activeNotes = computed(() =>
    this.activeTab() === 'unsorted' ? this.unsortedNotes() : this.filedNotes()
  );

  constructor(
    private route: ActivatedRoute,
    private spacesService: SpacesService,
    private inboxService: InboxService,
    private toastService: ToastService
  ) {}

  ngOnInit(): void {
    this.route.parent?.paramMap.subscribe(params => {
      const path1 = params.get('path1');
      const path2 = params.get('path2');
      const path3 = params.get('path3');
      const fullPath = [path1, path2, path3].filter(Boolean).join('/');
      if (fullPath) {
        this.spacesService.getSpaceByPath(fullPath).subscribe({
          next: (space) => {
            this.spaceId = space.id;
            this.loadNotes();
          }
        });
      }
    });
  }

  switchTab(tab: 'unsorted' | 'filed'): void {
    this.activeTab.set(tab);
    this.selectedNote.set(null);
    this.currentSuggestion.set(null);
    this.loadNotes();
  }

  loadNotes(): void {
    if (!this.spaceId) return;
    this.loading.set(true);
    const tab = this.activeTab();
    const status = tab === 'unsorted' ? 'UNSORTED' : 'FILED';
    this.inboxService.getNotes(this.spaceId, status).subscribe({
      next: (notes) => {
        if (tab === 'unsorted') this.unsortedNotes.set(notes);
        else this.filedNotes.set(notes);
        this.loading.set(false);
      },
      error: () => this.loading.set(false)
    });
  }

  selectNote(note: InboxNote): void {
    this.selectedNote.set(note);
    this.showDiff.set(false);

    const suggestion = this.inboxService.parseSuggestion(note);
    this.currentSuggestion.set(suggestion);

    // Auto-generate suggestion if not yet available
    if (!suggestion) {
      this.requestSuggestion();
    }
  }

  requestSuggestion(): void {
    const note = this.selectedNote();
    if (!note || this.suggestingNote()) return;

    this.suggestingNote.set(true);
    this.inboxService.generateSuggestion(this.spaceId, note.id).subscribe({
      next: (updated) => {
        this.updateNoteInList(updated);
        this.selectedNote.set(updated);
        this.currentSuggestion.set(this.inboxService.parseSuggestion(updated));
        this.suggestingNote.set(false);
      },
      error: () => {
        this.toastService.error('Error', 'Failed to generate suggestion');
        this.suggestingNote.set(false);
      }
    });
  }

  fileWithSuggestion(): void {
    const note = this.selectedNote();
    const suggestion = this.currentSuggestion();
    if (!note || !suggestion || suggestion.error) return;

    const documentPath = suggestion.action === 'APPEND_TO_DOCUMENT'
      ? suggestion.documentPath!
      : suggestion.newDocumentPath!;

    this.doFile(note.id, documentPath, suggestion.mergedContent, suggestion.action === 'CREATE_DOCUMENT', suggestion.newDocumentTitle);
  }

  acceptDiff(): void {
    this.showDiff.set(false);
    this.fileWithSuggestion();
  }

  fileAndSaveRule(): void {
    const note = this.selectedNote();
    const suggestion = this.currentSuggestion();
    if (!note || !suggestion || suggestion.error) return;

    const documentPath = suggestion.action === 'APPEND_TO_DOCUMENT'
      ? suggestion.documentPath!
      : suggestion.newDocumentPath!;

    this.showDontAskDialog.set(false);
    this.filing.set(true);

    this.inboxService.fileNote(this.spaceId, note.id, {
      documentPath,
      mergedContent: suggestion.mergedContent,
      createNew: suggestion.action === 'CREATE_DOCUMENT',
      newTitle: suggestion.newDocumentTitle,
      saveAsRule: true,
      ruleCondition: this.ruleConditionInput || undefined
    }).subscribe({
      next: (updated) => {
        this.toastService.success('Filed', 'Note filed and rule saved.');
        this.removeFromUnsorted(updated.id);
        this.filing.set(false);
        this.selectedNote.set(null);
        this.currentSuggestion.set(null);
      },
      error: () => {
        this.toastService.error('Error', 'Failed to file note');
        this.filing.set(false);
      }
    });
  }

  dismiss(): void {
    const note = this.selectedNote();
    if (!note) return;

    this.inboxService.dismissNote(this.spaceId, note.id).subscribe({
      next: () => {
        this.toastService.success('Dismissed', 'Note has been dismissed.');
        this.removeFromUnsorted(note.id);
        this.selectedNote.set(null);
        this.currentSuggestion.set(null);
      },
      error: () => this.toastService.error('Error', 'Failed to dismiss note')
    });
  }

  getInitials(name: string): string {
    return name.split(' ').map(n => n[0]).join('').toUpperCase().substring(0, 2);
  }

  private doFile(noteId: string, documentPath: string, mergedContent: string, createNew: boolean, newTitle?: string): void {
    this.filing.set(true);
    this.inboxService.fileNote(this.spaceId, noteId, {
      documentPath,
      mergedContent,
      createNew,
      newTitle
    }).subscribe({
      next: (updated) => {
        this.toastService.success('Filed', 'Note filed successfully.');
        this.removeFromUnsorted(updated.id);
        this.filing.set(false);
        this.selectedNote.set(null);
        this.currentSuggestion.set(null);
      },
      error: () => {
        this.toastService.error('Error', 'Failed to file note');
        this.filing.set(false);
      }
    });
  }

  private removeFromUnsorted(noteId: string): void {
    this.unsortedNotes.update(notes => notes.filter(n => n.id !== noteId));
  }

  private updateNoteInList(updated: InboxNote): void {
    this.unsortedNotes.update(notes => notes.map(n => n.id === updated.id ? updated : n));
  }
}
