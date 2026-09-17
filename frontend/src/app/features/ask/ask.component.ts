import { Component, ElementRef, OnDestroy, OnInit, ViewChild, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Title, SafeHtml } from '@angular/platform-browser';
import { Subject, Subscription, debounceTime, distinctUntilChanged, switchMap } from 'rxjs';
import {
  AiService, ConversationMessage, ConversationSummary, EditProposal, MessageSource, MessageToolCall
} from '../../core/api/ai.service';
import { SpacesService, Space } from '../../core/api/spaces.service';
import { MarkdownRenderService } from '../../shared/services/markdown-render.service';
import { ToastService } from '../../shared/services/toast.service';
import { spaceRoute } from '../../shared/utils/route-utils';
import { LayoutComponent } from '../../shared/components/layout.component';
import { AskComposerComponent, AskSubmission } from './ask-composer.component';
import { ProposalCardComponent } from './proposal-card.component';
import { SaveAnswerDialogComponent, SavedAnswer } from './save-answer-dialog.component';
import { DraftDialogComponent, DraftSubmission } from './draft-dialog.component';

/**
 * The assistant. Every conversation of the user, whatever space it is about,
 * on the left; the open conversation on the right. A new conversation starts
 * with a space (and optionally one document of it) chosen in the ask box.
 */
@Component({
  selector: 'app-ask',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, LayoutComponent, AskComposerComponent, ProposalCardComponent, SaveAnswerDialogComponent, DraftDialogComponent],
  template: `
    <app-layout>
    <div class="ask-page">
      <aside class="ask-sidebar" [class.open]="sidebarOpen()">
        <div class="sidebar-top">
          <button type="button" class="btn btn-primary new-btn" (click)="newConversation()">
            <span translate="no" class="material-icons">add</span>New conversation
          </button>
          <div class="sidebar-search">
            <span translate="no" class="material-icons">search</span>
            <input
              type="search"
              placeholder="Search conversations"
              aria-label="Search conversations"
              [ngModel]="query()"
              (ngModelChange)="onQuery($event)"
            />
          </div>
        </div>

        <div class="conversation-list">
          @if (listLoading()) {
            <p class="list-hint">Loading</p>
          } @else if (!conversations().length) {
            <p class="list-hint">{{ query() ? 'No conversation matches.' : 'No conversations yet.' }}</p>
          }
          @for (c of conversations(); track c.id) {
            <div class="conversation-item" [class.active]="c.id === activeId()">
              @if (renamingId() === c.id) {
                <input
                  class="rename-input"
                  [(ngModel)]="renameText"
                  (keydown.enter)="saveRename(c)"
                  (keydown.escape)="renamingId.set(null)"
                  (blur)="saveRename(c)"
                  aria-label="Conversation title"
                />
              } @else {
                <a class="conversation-link" [routerLink]="['/ask', c.id]" (click)="sidebarOpen.set(false)">
                  <span class="conversation-title">{{ c.title }}</span>
                  <span class="conversation-meta">
                    <span class="space-tag">{{ c.spaceName }}</span>
                    @if (c.documentPath) {
                      <span class="doc-tag" [title]="c.documentPath">{{ fileName(c.documentPath) }}</span>
                    }
                    <span class="conversation-date">{{ relativeDate(c.updatedAt) }}</span>
                  </span>
                </a>
                <div class="item-actions">
                  <button type="button" class="icon-btn" title="Rename" (click)="startRename(c)">
                    <span translate="no" class="material-icons">edit</span>
                  </button>
                  <button type="button" class="icon-btn" title="Delete" (click)="toDelete.set(c)">
                    <span translate="no" class="material-icons">delete_outline</span>
                  </button>
                </div>
              }
            </div>
          }
        </div>
      </aside>

      @if (sidebarOpen()) {
        <div class="sidebar-backdrop" (click)="sidebarOpen.set(false)"></div>
      }

      <section class="ask-main">
        <header class="ask-header">
          <button type="button" class="icon-btn sidebar-toggle" (click)="sidebarOpen.set(!sidebarOpen())" title="Conversations">
            <span translate="no" class="material-icons">{{ sidebarOpen() ? 'close' : 'forum' }}</span>
          </button>
          @if (active(); as c) {
            <div class="header-text">
              <h1>{{ c.title }}</h1>
              <a class="header-space" [routerLink]="spaceLink(c.spaceFullPath)">{{ c.spaceName }}</a>
            </div>
          } @else {
            <div class="header-text">
              <h1>Ask</h1>
              <span class="header-space">Questions about your documentation, answered from the documents</span>
            </div>
          }
          <button type="button" class="btn btn-secondary draft-btn" (click)="drafting.set(true)" [disabled]="streaming()">
            <span translate="no" class="material-icons">edit_document</span><span class="draft-label">Write a draft</span>
          </button>
        </header>

        <div class="messages" #scroller>
          @if (!activeId() && !messages().length) {
            <div class="empty">
              <span translate="no" class="material-icons">auto_awesome</span>
              <h2>What do you want to know?</h2>
              <p>Pick a space, ask a question. Answers name the documents they come from, and your conversations stay here for later.</p>
            </div>
          }

          @for (m of messages(); track m.id) {
            <article class="message" [class]="'message ' + m.role">
              @if (m.role === 'user') {
                <div class="bubble">{{ m.content }}</div>
              } @else {
                @if (m.toolCalls.length) {
                  <details class="tool-log">
                    <summary>{{ toolSummary(m.toolCalls) }}</summary>
                    <ul>
                      @for (t of m.toolCalls; track $index) {
                        <li [class.failed]="!t.ok">{{ t.label }}</li>
                      }
                    </ul>
                  </details>
                }
                <div class="answer markdown-readonly" [innerHTML]="render(m.content)"></div>
                @for (p of m.proposals; track p.id) {
                  <app-proposal-card
                    [proposal]="p"
                    [working]="workingProposal() === p.id"
                    (apply)="applyProposal(m, p)"
                    (discard)="discardProposal(m, p)"
                  />
                }
                @if (m.createdDocuments.length) {
                  <div class="doc-links created">
                    <span class="links-label">Created</span>
                    @for (d of m.createdDocuments; track d.path) {
                      <a class="doc-link" [routerLink]="docLink(d)" [queryParams]="{ path: d.path }">
                        <span translate="no" class="material-icons">note_add</span>{{ d.title || fileName(d.path) }}
                      </a>
                    }
                  </div>
                }
                @if (m.createdTasks.length) {
                  <div class="doc-links created">
                    <span class="links-label">Tasks</span>
                    @for (t of m.createdTasks; track t.id) {
                      <a class="doc-link" routerLink="/tasks">
                        <span translate="no" class="material-icons">task_alt</span>{{ t.title }}
                      </a>
                    }
                  </div>
                }
                @if (m.sources.length) {
                  <div class="doc-links">
                    <span class="links-label">Sources</span>
                    @for (s of m.sources; track s.spaceId + s.path) {
                      <a class="doc-link" [routerLink]="docLink(s)" [queryParams]="{ path: s.path }" [title]="s.path">
                        <span translate="no" class="material-icons">description</span>{{ s.title || fileName(s.path) }}
                      </a>
                    }
                  </div>
                }
                <div class="message-actions">
                  <button type="button" class="btn btn-ghost" (click)="saving.set(m)">
                    <span translate="no" class="material-icons">note_add</span>Save as document
                  </button>
                  <button type="button" class="btn btn-ghost" (click)="copy(m)">
                    <span translate="no" class="material-icons">content_copy</span>Copy
                  </button>
                </div>
              }
            </article>
          }

          @if (streaming()) {
            <article class="message assistant live">
              @if (liveTools().length || status()) {
                <ul class="live-tools">
                  @for (t of liveTools(); track $index) {
                    <li [class.failed]="!t.ok"><span translate="no" class="material-icons">{{ t.ok ? 'check' : 'error_outline' }}</span>{{ t.label }}</li>
                  }
                  @if (status() && !liveText()) {
                    <li class="running"><span translate="no" class="material-icons spin">progress_activity</span>{{ status() }}</li>
                  }
                </ul>
              }
              @if (liveText()) {
                <div class="answer markdown-readonly" [innerHTML]="renderLive(liveText())"></div>
              } @else if (!status()) {
                <p class="thinking">Thinking</p>
              }
            </article>
          }

          @if (turnError()) {
            <p class="turn-error"><span translate="no" class="material-icons">error_outline</span>{{ turnError() }}</p>
          }
        </div>

        <div class="composer-wrap">
          <app-ask-composer
            #composer
            [spaces]="spaces()"
            [fixedSpaceName]="active()?.spaceName ?? null"
            [initialSpaceId]="requestedSpaceId()"
            [documentPath]="active() ? (active()!.documentPath ?? null) : requestedDocument()"
            [busy]="streaming()"
            [autofocus]="true"
            [placeholder]="active() ? 'Ask a follow-up' : 'Ask about your documentation'"
            (submitted)="send($event)"
            (clearDocument)="requestedDocument.set(null)"
          />
        </div>
      </section>
    </div>

    @if (toDelete(); as c) {
      <div class="modal-overlay" (click)="toDelete.set(null)">
        <div class="modal" role="dialog" aria-labelledby="delete-conversation-title" (click)="$event.stopPropagation()">
          <div class="modal-header">
            <h2 id="delete-conversation-title">Delete conversation</h2>
          </div>
          <div class="modal-body">
            <p>"{{ c.title }}" and all its messages will be deleted. Documents it created or changed stay as they are.</p>
          </div>
          <div class="modal-footer">
            <button type="button" class="btn btn-ghost" (click)="toDelete.set(null)">Cancel</button>
            <button type="button" class="btn btn-danger" (click)="confirmDelete(c)">Delete</button>
          </div>
        </div>
      </div>
    }

    @if (drafting()) {
      <app-draft-dialog
        [spaces]="spaces()"
        [initialSpaceId]="requestedSpaceId()"
        (submitted)="startDraft($event)"
        (cancelled)="drafting.set(false)"
      />
    }

    @if (saving(); as m) {
      <app-save-answer-dialog
        [content]="m.content"
        [suggestedTitle]="active()?.title ?? ''"
        [preferredSpaceId]="active()?.spaceId ?? null"
        (saved)="onSaved($event)"
        (cancelled)="saving.set(null)"
      />
    }
    </app-layout>
  `,
  styles: [`
    :host { display: block; }

    .ask-page {
      display: grid;
      grid-template-columns: 300px minmax(0, 1fr);
      height: calc(100vh - 64px);
      background: var(--background);
    }

    .ask-sidebar {
      display: flex;
      flex-direction: column;
      min-height: 0;
      border-right: 1px solid var(--border);
      background: var(--surface);
    }

    .sidebar-top {
      display: flex;
      flex-direction: column;
      gap: var(--spacing-sm);
      padding: var(--spacing-md);
      border-bottom: 1px solid var(--border-light);
    }

    .new-btn { justify-content: center; }

    .sidebar-search {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 6px 10px;
      border: 1px solid var(--border);
      border-radius: var(--radius-md);
      background: var(--background);

      .material-icons { font-size: 18px; color: var(--text-muted); }

      input {
        flex: 1;
        min-width: 0;
        border: 0;
        outline: none;
        background: transparent;
        color: var(--text-primary);
        font: inherit;
        font-size: 14px;
      }
    }

    .conversation-list {
      flex: 1;
      overflow-y: auto;
      padding: var(--spacing-sm);
    }

    .list-hint {
      padding: var(--spacing-md);
      font-size: 13px;
      color: var(--text-muted);
      text-align: center;
    }

    .conversation-item {
      position: relative;
      display: flex;
      align-items: center;
      border-radius: var(--radius-md);

      &:hover, &.active { background: var(--background-darker); }
      &:hover .item-actions, &.active .item-actions { opacity: 1; }
    }

    .conversation-link {
      flex: 1;
      min-width: 0;
      display: flex;
      flex-direction: column;
      gap: 3px;
      padding: 9px 10px;
      color: inherit;
      text-decoration: none;
    }

    .conversation-title {
      font-size: 14px;
      color: var(--text-primary);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .conversation-meta {
      display: flex;
      align-items: center;
      gap: 6px;
      min-width: 0;
      font-size: 12px;
      color: var(--text-muted);
    }

    .space-tag, .doc-tag {
      padding: 1px 7px;
      border-radius: var(--radius-full);
      background: var(--primary-light);
      color: var(--text-primary);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    /* The space names the conversation; the document gives way first when the row is tight. */
    .space-tag { flex-shrink: 0; max-width: 120px; }
    .doc-tag { min-width: 0; background: var(--background-darker); }

    .conversation-date { white-space: nowrap; }

    .item-actions {
      display: flex;
      opacity: 0;
      padding-right: 4px;

      .icon-btn { width: 28px; height: 28px; }
      .material-icons { font-size: 17px; }
    }

    .rename-input {
      flex: 1;
      margin: 6px;
      padding: 6px 8px;
      border: 1px solid var(--primary);
      border-radius: var(--radius-sm);
      background: var(--surface);
      color: var(--text-primary);
      font: inherit;
      font-size: 14px;
    }

    .ask-main {
      display: flex;
      flex-direction: column;
      min-width: 0;
      min-height: 0;
    }

    .ask-header {
      display: flex;
      align-items: center;
      gap: var(--spacing-sm);
      padding: var(--spacing-md) var(--spacing-lg);
      border-bottom: 1px solid var(--border-light);
      background: var(--surface);
    }

    .sidebar-toggle, .sidebar-backdrop { display: none; }

    .draft-btn {
      flex-shrink: 0;
      margin-left: auto;

      .material-icons { font-size: 18px; }
    }

    .header-text {
      min-width: 0;
      h1 {
        margin: 0;
        font-size: 17px;
        font-weight: 600;
        color: var(--text-primary);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
    }

    .header-space {
      font-size: 13px;
      color: var(--text-muted);
      text-decoration: none;
    }

    a.header-space:hover { color: var(--primary-dark); }

    .messages {
      flex: 1;
      overflow-y: auto;
      padding: var(--spacing-lg);
      display: flex;
      flex-direction: column;
      gap: var(--spacing-lg);

      > * { width: 100%; max-width: 820px; margin: 0 auto; }
    }

    .empty {
      margin-top: 8vh;
      text-align: center;
      color: var(--text-secondary);

      > .material-icons { font-size: 40px; color: var(--primary); }
      h2 { margin: var(--spacing-sm) 0; font-size: 22px; color: var(--text-primary); }
      p { max-width: 460px; margin: 0 auto; line-height: 1.5; }
    }

    .message.user { display: flex; justify-content: flex-end; }

    .bubble {
      max-width: 80%;
      padding: 10px 14px;
      border-radius: var(--radius-lg) var(--radius-lg) var(--radius-sm) var(--radius-lg);
      background: var(--primary-dark);
      color: #fff;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
      line-height: 1.5;
    }

    /* The shared Markdown typography, without the padding and height it has as a document page. */
    .answer.markdown-readonly {
      min-height: 0;
      padding: 0;
      overflow-wrap: anywhere;
    }

    .tool-log {
      margin-bottom: var(--spacing-sm);
      font-size: 13px;
      color: var(--text-muted);

      summary { cursor: pointer; }
      ul { margin: 6px 0 0; padding-left: 20px; }
      li.failed { color: var(--error); }
    }

    .live-tools {
      margin: 0 0 var(--spacing-sm);
      padding: 0;
      list-style: none;
      font-size: 13px;
      color: var(--text-muted);

      li { display: flex; align-items: center; gap: 6px; padding: 2px 0; }
      li.failed { color: var(--error); }
      .material-icons { font-size: 16px; }
    }

    .spin { animation: ask-spin 1s linear infinite; }

    @keyframes ask-spin { to { transform: rotate(360deg); } }

    .thinking {
      margin: 0;
      color: var(--text-muted);
      animation: ask-pulse 1.4s ease-in-out infinite;
    }

    @keyframes ask-pulse { 50% { opacity: 0.4; } }

    .doc-links {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 6px;
      margin-top: var(--spacing-sm);
    }

    .links-label {
      font-size: 12px;
      font-weight: 600;
      color: var(--text-muted);
      margin-right: 2px;
    }

    .doc-link {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      max-width: 260px;
      padding: 3px 9px;
      border: 1px solid var(--border);
      border-radius: var(--radius-full);
      background: var(--surface);
      color: var(--text-secondary);
      font-size: 13px;
      text-decoration: none;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;

      .material-icons { font-size: 15px; }
      &:hover { border-color: var(--primary); color: var(--primary-dark); }
    }

    .created .doc-link { border-color: var(--success); }

    .message-actions {
      display: flex;
      gap: 2px;
      margin-top: 6px;
      opacity: 0.75;

      .btn { padding: 4px 8px; font-size: 13px; }
      .material-icons { font-size: 16px; }
    }

    .turn-error {
      display: flex;
      align-items: center;
      gap: 6px;
      color: var(--error);
      font-size: 14px;
    }

    .composer-wrap {
      padding: var(--spacing-sm) var(--spacing-lg) var(--spacing-lg);

      app-ask-composer { display: block; max-width: 820px; margin: 0 auto; }
    }

    @media (max-width: 860px) {
      .ask-page { grid-template-columns: minmax(0, 1fr); }

      .ask-sidebar {
        position: fixed;
        top: 64px;
        bottom: 0;
        left: 0;
        z-index: 50;
        width: min(320px, 88vw);
        transform: translateX(-100%);
        transition: transform var(--transition-base);
        box-shadow: var(--shadow-lg);

        &.open { transform: none; }
      }

      .sidebar-backdrop {
        display: block;
        position: fixed;
        inset: 64px 0 0 0;
        z-index: 49;
        background: rgba(26, 46, 48, 0.35);
      }

      .item-actions { opacity: 1; }
      .draft-label { display: none; }
      .sidebar-toggle { display: inline-flex; }
      .messages { padding: var(--spacing-md); }
      .composer-wrap { padding: var(--spacing-sm) var(--spacing-md) var(--spacing-md); }
      .bubble { max-width: 92%; }
    }
  `]
})
export class AskComponent implements OnInit, OnDestroy {
  @ViewChild('scroller') scroller?: ElementRef<HTMLDivElement>;
  @ViewChild('composer') composer?: AskComposerComponent;

  private ai = inject(AiService);
  private spacesService = inject(SpacesService);
  private markdown = inject(MarkdownRenderService);
  private toast = inject(ToastService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private title = inject(Title);
  private host = inject(ElementRef<HTMLElement>);

  spaces = signal<Space[]>([]);
  conversations = signal<ConversationSummary[]>([]);
  listLoading = signal(true);
  query = signal('');
  activeId = signal<string | null>(null);
  messages = signal<ConversationMessage[]>([]);
  requestedSpaceId = signal<string | null>(null);
  requestedDocument = signal<string | null>(null);

  streaming = signal(false);
  liveText = signal('');
  liveTools = signal<MessageToolCall[]>([]);
  status = signal<string | null>(null);
  turnError = signal<string | null>(null);
  workingProposal = signal<string | null>(null);

  sidebarOpen = signal(false);
  renamingId = signal<string | null>(null);
  renameText = '';
  toDelete = signal<ConversationSummary | null>(null);
  saving = signal<ConversationMessage | null>(null);
  drafting = signal(false);

  active = computed(() => this.conversations().find(c => c.id === this.activeId()) ?? null);

  /** A draft asked for while another conversation was open; it starts once the page is on a new one. */
  private pendingDraft?: DraftSubmission;
  private queries = new Subject<string>();
  private subscriptions = new Subscription();
  private turn?: Subscription;
  private rendered = new Map<string, SafeHtml>();
  private mermaidTimer?: number;

  ngOnInit(): void {
    this.spacesService.getSpaces().subscribe({ next: spaces => this.spaces.set(spaces) });
    this.loadConversations('');

    this.subscriptions.add(
      this.queries.pipe(
        debounceTime(250),
        distinctUntilChanged(),
        switchMap(q => this.ai.listConversations(q))
      ).subscribe({ next: list => this.conversations.set(list) })
    );

    this.subscriptions.add(this.route.paramMap.subscribe(params => this.open(params.get('id'))));
  }

  ngOnDestroy(): void {
    this.subscriptions.unsubscribe();
    this.turn?.unsubscribe();
    clearTimeout(this.mermaidTimer);
  }

  private loadConversations(query: string): void {
    this.listLoading.set(true);
    this.ai.listConversations(query).subscribe({
      next: list => {
        this.conversations.set(list);
        this.listLoading.set(false);
        this.updateTitle();
      },
      error: () => this.listLoading.set(false)
    });
  }

  private open(id: string | null): void {
    // The URL of a conversation that is streaming right now was set by this page; nothing to load.
    if (id && id === this.activeId() && (this.streaming() || this.messages().length)) return;

    this.turn?.unsubscribe();
    this.streaming.set(false);
    this.turnError.set(null);
    this.activeId.set(id);
    this.messages.set([]);

    if (!id) {
      const params = this.route.snapshot.queryParamMap;
      this.requestedSpaceId.set(params.get('space'));
      this.requestedDocument.set(params.get('doc'));
      this.updateTitle();
      if (params.get('draft')) {
        this.router.navigate([], { queryParams: { draft: null }, queryParamsHandling: 'merge', replaceUrl: true });
        this.drafting.set(true);
      }
      if (this.pendingDraft) {
        const draft = this.pendingDraft;
        this.pendingDraft = undefined;
        this.send({ message: draft.message, spaceId: draft.spaceId, documentPath: null }, draft);
        return;
      }
      const question = params.get('q');
      if (question && params.get('space')) {
        // Arriving from the dashboard or the command palette with a question already typed.
        this.router.navigate([], { queryParams: { q: null }, queryParamsHandling: 'merge', replaceUrl: true });
        this.send({ message: question, spaceId: params.get('space')!, documentPath: params.get('doc') });
      }
      return;
    }

    this.ai.getConversation(id).subscribe({
      next: detail => {
        this.messages.set(detail.messages);
        // A conversation opened by link may not be in the (possibly filtered) list yet.
        if (!this.conversations().some(c => c.id === id)) {
          this.conversations.update(list => [detail.conversation, ...list]);
        }
        this.updateTitle();
        this.afterRender(true);
      },
      error: () => {
        this.toast.error('Conversation not found', 'It may have been deleted.');
        this.router.navigate(['/ask'], { replaceUrl: true });
      }
    });
  }

  newConversation(): void {
    this.sidebarOpen.set(false);
    this.router.navigate(['/ask']);
    setTimeout(() => this.composer?.focus());
  }

  onQuery(value: string): void {
    this.query.set(value);
    this.queries.next(value.trim());
  }

  /** A draft is a new conversation whose first answer is written from the space's recent material. */
  startDraft(draft: DraftSubmission): void {
    this.drafting.set(false);
    if (this.activeId()) {
      this.pendingDraft = draft;
      this.router.navigate(['/ask']);
      return;
    }
    this.send({ message: draft.message, spaceId: draft.spaceId, documentPath: null }, draft);
  }

  send(submission: AskSubmission, draft?: DraftSubmission): void {
    if (this.streaming()) return;
    const conversationId = this.activeId();
    this.turnError.set(null);
    this.liveText.set('');
    this.liveTools.set([]);
    this.status.set(null);
    this.streaming.set(true);
    this.messages.update(list => [...list, localUserMessage(submission.message)]);
    this.afterRender(true);

    const request = conversationId
      ? { conversationId, message: submission.message }
      : {
          spaceId: submission.spaceId,
          documentPath: submission.documentPath ?? undefined,
          message: submission.message,
          draftTemplate: draft?.template,
          draftDays: draft?.days
        };

    this.turn = this.ai.sendTurn(request).subscribe({
      next: event => {
        switch (event.type) {
          case 'conversation':
            this.upsertConversation(event.conversation);
            this.updateTitle();
            if (!conversationId) {
              this.activeId.set(event.conversation.id);
              this.router.navigate(['/ask', event.conversation.id], { replaceUrl: true });
            }
            break;
          case 'status':
            this.status.set(event.label);
            break;
          case 'tool':
            this.liveTools.update(list => [...list, event.toolCall]);
            this.status.set(null);
            break;
          case 'delta':
            this.liveText.update(text => text + event.text);
            this.afterRender(false);
            break;
          case 'reset':
            this.liveText.set('');
            break;
          case 'done':
            this.messages.update(list => [...list, event.message]);
            this.touchConversation(event.message.createdAt);
            this.updateTitle();
            this.afterRender(true);
            break;
          case 'error':
            this.turnError.set(event.message);
            break;
        }
      },
      complete: () => this.finishTurn(),
      error: () => this.finishTurn()
    });
  }

  private finishTurn(): void {
    this.streaming.set(false);
    this.liveText.set('');
    this.liveTools.set([]);
    this.status.set(null);
  }

  applyProposal(message: ConversationMessage, proposal: EditProposal): void {
    this.resolveProposal(message, proposal, this.ai.applyProposal(this.activeId()!, message.id, proposal.id));
  }

  discardProposal(message: ConversationMessage, proposal: EditProposal): void {
    this.resolveProposal(message, proposal, this.ai.discardProposal(this.activeId()!, message.id, proposal.id));
  }

  private resolveProposal(message: ConversationMessage, proposal: EditProposal, call: ReturnType<AiService['applyProposal']>): void {
    this.workingProposal.set(proposal.id);
    call.subscribe({
      next: updated => {
        this.workingProposal.set(null);
        this.messages.update(list => list.map(m => m.id !== message.id ? m : {
          ...m, proposals: m.proposals.map(p => p.id === updated.id ? updated : p)
        }));
        if (updated.status === 'APPLIED') this.toast.success('Change applied', `${updated.path} was updated and committed.`);
      },
      error: err => {
        this.workingProposal.set(null);
        this.toast.error('Could not update the change', err.error?.message || 'Please try again.');
      }
    });
  }

  startRename(c: ConversationSummary): void {
    this.renameText = c.title;
    this.renamingId.set(c.id);
  }

  saveRename(c: ConversationSummary): void {
    if (this.renamingId() !== c.id) return;
    this.renamingId.set(null);
    const title = this.renameText.trim();
    if (!title || title === c.title) return;
    this.ai.renameConversation(c.id, title).subscribe({
      next: updated => {
        this.upsertConversation(updated, false);
        this.updateTitle();
      },
      error: () => this.toast.error('Rename failed', 'The conversation keeps its old title.')
    });
  }

  confirmDelete(c: ConversationSummary): void {
    this.toDelete.set(null);
    this.ai.deleteConversation(c.id).subscribe({
      next: () => {
        this.conversations.update(list => list.filter(item => item.id !== c.id));
        if (this.activeId() === c.id) this.router.navigate(['/ask']);
      },
      error: () => this.toast.error('Delete failed', 'The conversation is still there.')
    });
  }

  onSaved(saved: SavedAnswer): void {
    this.saving.set(null);
    this.toast.success('Saved as document', saved.path, {
      action: {
        label: 'Open',
        handler: () => this.router.navigate(spaceRoute(saved.spaceFullPath, 'doc'), { queryParams: { path: saved.path } })
      }
    });
  }

  copy(message: ConversationMessage): void {
    navigator.clipboard.writeText(message.content).then(
      () => this.toast.success('Copied', 'The answer is on your clipboard.'),
      () => this.toast.error('Copy failed', 'Your browser did not allow it.')
    );
  }

  render(content: string): SafeHtml {
    let html = this.rendered.get(content);
    if (!html) {
      html = this.markdown.renderInline(content);
      this.rendered.set(content, html);
    }
    return html;
  }

  /** The growing answer changes on every delta, so it is rendered fresh and not cached. */
  renderLive(content: string): SafeHtml {
    return this.markdown.renderInline(content);
  }

  toolSummary(calls: MessageToolCall[]): string {
    const failed = calls.filter(c => !c.ok).length;
    const steps = `${calls.length} ${calls.length === 1 ? 'step' : 'steps'}`;
    return failed ? `${steps}, ${failed} failed` : steps;
  }

  docLink(source: MessageSource): string[] {
    return spaceRoute(source.spaceFullPath ?? '', 'doc');
  }

  spaceLink(fullPath: string): string[] {
    return spaceRoute(fullPath);
  }

  fileName(path: string): string {
    return path.split('/').pop() ?? path;
  }

  relativeDate(value: string): string {
    const date = new Date(value);
    const days = Math.floor((Date.now() - date.getTime()) / 86_400_000);
    if (days <= 0) return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    if (days === 1) return 'Yesterday';
    if (days < 7) return `${days} days ago`;
    return date.toLocaleDateString();
  }

  /** Insert or refresh a conversation and, when it was just used, move it to the top. */
  private upsertConversation(summary: ConversationSummary, toTop = true): void {
    this.conversations.update(list => {
      const rest = list.filter(c => c.id !== summary.id);
      if (toTop) return [summary, ...rest];
      return list.some(c => c.id === summary.id) ? list.map(c => c.id === summary.id ? summary : c) : [summary, ...rest];
    });
  }

  private touchConversation(updatedAt: string): void {
    const current = this.active();
    if (current) this.upsertConversation({ ...current, updatedAt });
  }

  private updateTitle(): void {
    const c = this.active();
    this.title.setTitle(c ? `${c.title} – Ask – DocuVault` : 'Ask – DocuVault');
  }

  private afterRender(forceScroll: boolean): void {
    setTimeout(() => {
      const el = this.scroller?.nativeElement;
      if (el) {
        const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 160;
        if (forceScroll || nearBottom) el.scrollTop = el.scrollHeight;
      }
    });
    clearTimeout(this.mermaidTimer);
    this.mermaidTimer = setTimeout(() => this.markdown.runMermaid(this.host.nativeElement), 50) as unknown as number;
  }
}

function localUserMessage(content: string): ConversationMessage {
  return {
    id: `local-${Date.now()}`,
    role: 'user',
    content,
    sources: [],
    toolCalls: [],
    createdDocuments: [],
    proposals: [],
    createdTasks: [],
    createdAt: new Date().toISOString()
  };
}
