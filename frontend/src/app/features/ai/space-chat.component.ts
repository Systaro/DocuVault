import { Component, OnInit, signal, computed, ViewChild, ElementRef, AfterViewChecked, ViewEncapsulation } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { SafeHtml } from '@angular/platform-browser';
import { forkJoin } from 'rxjs';
import { AiService, ChatHistory, ChatMessage } from '../../core/api/ai.service';
import { SpacesService, Space } from '../../core/api/spaces.service';
import { MarkdownRenderService } from '../../shared/services/markdown-render.service';
import { spaceRoute } from '../../shared/utils/route-utils';

@Component({
  selector: 'app-space-chat',
  standalone: true,
  imports: [CommonModule, FormsModule],
  encapsulation: ViewEncapsulation.None,
  template: `
    <div class="chat-page">
      <!-- History Panel -->
      <aside class="chat-history-panel" [class.open]="historyOpen()">
        @if (space()) {
          <div class="chat-context">
            <div class="context-header">
              <span class="material-icons">hub</span>
              <span>Context</span>
            </div>
            @if (contextRepos().length > 0) {
              <div class="context-list">
                @for (repo of contextRepos(); track repo.id) {
                  <button class="context-repo" (click)="openContextRepo(repo)" [title]="'Open ' + repo.name">
                    <span class="material-icons">menu_book</span>
                    <span class="context-repo-name">{{ repo.name }}</span>
                  </button>
                }
              </div>
            } @else {
              <p class="context-hint">{{ contextLabel() }}</p>
            }
          </div>
        }

        <div class="history-header">
          <h3>Conversations</h3>
          <button class="history-new-btn" (click)="startNewChat()" title="New conversation">
            <span class="material-icons">add</span>
          </button>
        </div>

        @if (historiesLoading()) {
          <div class="history-loading">
            <span class="material-icons spin">sync</span>
          </div>
        } @else if (chatHistories().length === 0) {
          <div class="history-empty">
            <span class="material-icons">forum</span>
            <p>No conversations yet</p>
          </div>
        } @else {
          <div class="history-list">
            @for (history of chatHistories(); track history.id) {
              <div
                class="history-item"
                [class.active]="currentChat()?.id === history.id"
                (click)="loadChat(history)"
              >
                <div class="history-item-content">
                  <div class="history-title">{{ history.title || 'Untitled' }}</div>
                  <div class="history-date">{{ formatDate(history.updatedAt) }}</div>
                </div>
                <button
                  class="history-delete-btn"
                  (click)="deleteChat(history, $event)"
                  title="Delete conversation"
                >
                  <span class="material-icons">delete_outline</span>
                </button>
              </div>
            }
          </div>
        }
      </aside>

      <!-- Main Chat Area -->
      <div class="chat-main">
        <!-- Mobile toggle -->
        <button class="history-toggle" (click)="historyOpen.set(!historyOpen())">
          <span class="material-icons">{{ historyOpen() ? 'close' : 'menu' }}</span>
        </button>

        @if (space(); as sp) {
          <header class="chat-space-header">
            @if (sp.logoUrl) {
              <img class="chat-space-logo" [src]="sp.logoUrl" [alt]="sp.name" />
            } @else {
              <span class="material-icons chat-space-logo-fallback">{{ sp.type === 'GROUP' ? 'folder_special' : 'menu_book' }}</span>
            }
            <div class="chat-space-heading">
              <span class="chat-space-name">{{ sp.name }}</span>
              <span class="chat-space-scope">{{ contextLabel() }}</span>
            </div>
          </header>
        }

        @if (!currentChat()) {
          <!-- Empty State -->
          <div class="chat-empty-state">
            <span class="material-icons chat-empty-icon">auto_awesome</span>
            <h2>AI Chat</h2>
            <p>Ask questions about your documentation. The AI will search through your files and provide answers with source references.</p>
            <button class="btn btn-primary" (click)="startNewChat()">
              <span class="material-icons">add</span>
              Start a conversation
            </button>
          </div>
        } @else {
          <!-- Messages -->
          <div class="chat-messages" #messagesContainer>
            @if (currentChat()!.messages.length === 0 && !sending()) {
              <div class="chat-start-hint">
                <span class="material-icons">lightbulb</span>
                <p>Ask anything about the documentation in this space.</p>
              </div>
            }

            @for (msg of currentChat()!.messages; track $index) {
              <div class="chat-message" [class.user]="msg.role === 'user'" [class.assistant]="msg.role === 'assistant'">
                <div class="message-avatar">
                  <span class="material-icons">{{ msg.role === 'user' ? 'person' : 'auto_awesome' }}</span>
                </div>
                <div class="message-body">
                  @if (msg.role === 'user') {
                    <div class="message-content user-content">{{ msg.content }}</div>
                  } @else {
                    <div class="message-content assistant-content" [innerHTML]="renderMarkdown(msg.content)"></div>
                  }
                  @if (msg.sources && msg.sources.length > 0) {
                    <div class="message-sources">
                      <span class="sources-label">Sources:</span>
                      @for (source of msg.sources; track source) {
                        <a class="source-link" (click)="navigateToSource(source)" title="Open document">
                          <span class="material-icons">description</span>
                          {{ formatSourceName(source) }}
                        </a>
                      }
                    </div>
                  }
                </div>
              </div>
            }

            @if (sending()) {
              <div class="chat-message assistant">
                <div class="message-avatar">
                  <span class="material-icons">auto_awesome</span>
                </div>
                <div class="message-body">
                  <div class="typing-indicator">
                    <span></span>
                    <span></span>
                    <span></span>
                  </div>
                </div>
              </div>
            }
          </div>

          <!-- Input Bar -->
          <div class="chat-input-bar">
            <div class="chat-input-wrapper">
              <textarea
                #chatInput
                [(ngModel)]="messageInput"
                (keydown)="onKeydown($event)"
                (input)="autoGrow($event)"
                placeholder="Ask about your documentation..."
                rows="1"
                [disabled]="sending()"
              ></textarea>
              <button
                class="send-btn"
                (click)="sendMessage()"
                [disabled]="!messageInput.trim() || sending()"
                title="Send message"
              >
                <span class="material-icons">send</span>
              </button>
            </div>
          </div>
        }
      </div>
    </div>
  `,
  styles: [`
    .chat-page {
      display: flex;
      height: 100%;
      min-height: 0;
      background: var(--background-darker);
    }

    /* ── History Panel ── */
    .chat-history-panel {
      width: 280px;
      flex-shrink: 0;
      background: var(--surface);
      border-right: 1px solid var(--border);
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }

    .history-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 16px;
      border-bottom: 1px solid var(--border);

      h3 {
        font-size: 14px;
        font-weight: 600;
        color: var(--text-primary);
        margin: 0;
      }
    }

    .history-new-btn {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 32px;
      height: 32px;
      border: 1px solid var(--border);
      border-radius: var(--radius-md, 8px);
      background: none;
      color: var(--text-secondary);
      cursor: pointer;
      transition: all 0.15s;

      .material-icons { font-size: 20px; }

      &:hover {
        background: var(--background);
        color: var(--primary);
        border-color: var(--primary);
      }
    }

    .history-loading {
      display: flex;
      justify-content: center;
      padding: 32px;
      color: var(--text-muted);
    }

    .spin {
      animation: spin 1s linear infinite;
    }
    @keyframes spin {
      to { transform: rotate(360deg); }
    }

    .history-empty {
      display: flex;
      flex-direction: column;
      align-items: center;
      padding: 32px 16px;
      color: var(--text-muted);
      text-align: center;

      .material-icons {
        font-size: 32px;
        margin-bottom: 8px;
        opacity: 0.5;
      }

      p {
        font-size: 13px;
        margin: 0;
      }
    }

    .history-list {
      flex: 1;
      overflow-y: auto;
      padding: 8px;
    }

    .history-item {
      display: flex;
      align-items: center;
      gap: 4px;
      padding: 10px 12px;
      border-radius: var(--radius-md, 8px);
      cursor: pointer;
      transition: background 0.15s;
      margin-bottom: 2px;

      &:hover {
        background: var(--background);

        .history-delete-btn { opacity: 1; }
      }

      &.active {
        background: rgba(111, 179, 184, 0.1);

        .history-title { color: var(--primary); }
      }
    }

    .history-item-content {
      flex: 1;
      min-width: 0;
    }

    .history-title {
      font-size: 13px;
      font-weight: 500;
      color: var(--text-primary);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .history-date {
      font-size: 11px;
      color: var(--text-muted);
      margin-top: 2px;
    }

    .history-delete-btn {
      opacity: 0;
      display: flex;
      align-items: center;
      background: none;
      border: none;
      color: var(--text-muted);
      cursor: pointer;
      padding: 4px;
      border-radius: var(--radius-sm, 4px);
      transition: all 0.15s;
      flex-shrink: 0;

      .material-icons { font-size: 18px; }

      &:hover { color: var(--danger, #dc3545); }
    }

    /* ── Main Chat Area ── */
    .chat-main {
      flex: 1;
      display: flex;
      flex-direction: column;
      min-width: 0;
      position: relative;
    }

    /* ── Space header ── */
    .chat-space-header {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 12px 20px;
      border-bottom: 1px solid var(--border);
      background: var(--surface);
      flex-shrink: 0;
    }
    .chat-space-logo {
      width: 32px;
      height: 32px;
      border-radius: var(--radius-md, 8px);
      object-fit: cover;
      flex-shrink: 0;
    }
    .chat-space-logo-fallback {
      font-size: 28px;
      color: var(--primary);
      flex-shrink: 0;
    }
    .chat-space-heading {
      display: flex;
      flex-direction: column;
      min-width: 0;
    }
    .chat-space-name {
      font-size: 15px;
      font-weight: 600;
      color: var(--text-primary);
      line-height: 1.2;
    }
    .chat-space-scope {
      font-size: 12px;
      color: var(--text-muted);
    }

    /* ── Context section ── */
    .chat-context {
      padding: 12px;
      border-bottom: 1px solid var(--border);
    }
    .context-header {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 0 4px 8px;
      font-size: 12px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      color: var(--text-muted);

      .material-icons { font-size: 16px; }
    }
    .context-list {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }
    .context-repo {
      display: flex;
      align-items: center;
      gap: 8px;
      width: 100%;
      padding: 8px 10px;
      border: none;
      background: none;
      border-radius: var(--radius-md, 8px);
      color: var(--text-secondary);
      font-size: 13px;
      text-align: left;
      cursor: pointer;
      transition: all 0.15s;

      .material-icons { font-size: 18px; color: var(--primary); }

      &:hover {
        background: var(--background);
        color: var(--text-primary);
      }
    }
    .context-repo-name {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .context-hint {
      margin: 0;
      padding: 0 4px;
      font-size: 12px;
      color: var(--text-muted);
    }

    .history-toggle {
      display: none;
      position: absolute;
      top: 12px;
      left: 12px;
      z-index: 10;
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius-md, 8px);
      width: 36px;
      height: 36px;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      color: var(--text-secondary);

      .material-icons { font-size: 20px; }
    }

    /* ── Empty State ── */
    .chat-empty-state {
      flex: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 48px 24px;
      text-align: center;
      color: var(--text-muted);
    }

    .chat-empty-icon {
      font-size: 56px;
      color: var(--primary);
      margin-bottom: 16px;
      opacity: 0.6;
    }

    .chat-empty-state h2 {
      font-size: 22px;
      font-weight: 600;
      color: var(--text-primary);
      margin: 0 0 8px;
    }

    .chat-empty-state p {
      max-width: 440px;
      font-size: 14px;
      line-height: 1.6;
      margin: 0 0 24px;
    }

    /* ── Messages ── */
    .chat-messages {
      flex: 1;
      overflow-y: auto;
      padding: 24px 16px;
      display: flex;
      flex-direction: column;
      gap: 24px;
    }

    .chat-start-hint {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      flex: 1;
      color: var(--text-muted);
      text-align: center;
      padding: 48px;

      .material-icons {
        font-size: 36px;
        margin-bottom: 12px;
        opacity: 0.4;
      }

      p {
        font-size: 14px;
        margin: 0;
      }
    }

    .chat-message {
      display: flex;
      gap: 12px;
      max-width: 800px;
      width: 100%;
      margin: 0 auto;
    }

    .message-avatar {
      width: 32px;
      height: 32px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      margin-top: 2px;

      .material-icons { font-size: 18px; }
    }

    .chat-message.user .message-avatar {
      background: var(--primary);
      color: white;
    }

    .chat-message.assistant .message-avatar {
      background: var(--background);
      border: 1px solid var(--border);
      color: var(--primary);
    }

    .message-body {
      flex: 1;
      min-width: 0;
    }

    .message-content {
      font-size: 14px;
      line-height: 1.7;
      color: var(--text-primary);
    }

    .user-content {
      background: var(--primary);
      color: white;
      padding: 10px 16px;
      border-radius: 16px 16px 4px 16px;
      display: inline-block;
      white-space: pre-wrap;
      word-break: break-word;
    }

    /* ── Markdown in assistant messages ── */
    .assistant-content {
      background: var(--surface);
      border: 1px solid var(--border);
      padding: 16px 20px;
      border-radius: 4px 16px 16px 16px;

      p { margin: 0 0 0.75em; }
      p:last-child { margin-bottom: 0; }

      h1, h2, h3, h4, h5, h6 {
        color: var(--text-primary);
        font-weight: 600;
        margin: 1.25em 0 0.5em;
        line-height: 1.3;
      }
      h1:first-child, h2:first-child, h3:first-child { margin-top: 0; }
      h1 { font-size: 1.4em; }
      h2 { font-size: 1.2em; }
      h3 { font-size: 1.05em; }

      ul, ol { margin: 0 0 0.75em; padding-left: 1.5em; }
      ul { list-style: disc; }
      ol { list-style: decimal; }
      li { margin-bottom: 0.25em; }

      code {
        background: var(--background);
        padding: 0.15em 0.4em;
        border-radius: 4px;
        font-size: 0.875em;
        font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace;
        color: var(--primary-dark);
      }

      pre {
        background: #1f2937;
        color: #e5e7eb;
        padding: 14px 18px;
        border-radius: 8px;
        overflow-x: auto;
        margin: 0.75em 0;
        line-height: 1.5;
      }

      pre code {
        background: none;
        padding: 0;
        color: inherit;
        font-size: 0.85em;
      }

      blockquote {
        border-left: 3px solid var(--primary);
        margin: 0.75em 0;
        padding: 0.25em 1em;
        color: var(--text-secondary);
        background: var(--background);
        border-radius: 0 4px 4px 0;
      }

      blockquote p:last-child { margin-bottom: 0; }

      table {
        width: 100%;
        border-collapse: collapse;
        margin: 0.75em 0;
        font-size: 0.9em;
      }

      th, td {
        border: 1px solid var(--border);
        padding: 6px 10px;
        text-align: left;
      }

      th {
        background: var(--background);
        font-weight: 600;
      }

      a {
        color: var(--primary);
        text-decoration: none;
        &:hover { text-decoration: underline; }
      }

      strong { font-weight: 600; color: var(--text-primary); }
      hr { border: none; border-top: 1px solid var(--border); margin: 1em 0; }
      img { max-width: 100%; border-radius: 6px; }
    }

    /* ── Sources ── */
    .message-sources {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 6px;
      margin-top: 10px;
      padding-top: 10px;
      border-top: 1px solid var(--border-light, var(--border));
    }

    .sources-label {
      font-size: 11px;
      font-weight: 600;
      color: var(--text-muted);
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    .source-link {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 3px 10px;
      background: var(--background);
      border: 1px solid var(--border);
      border-radius: 999px;
      font-size: 12px;
      color: var(--text-secondary);
      cursor: pointer;
      text-decoration: none;
      transition: all 0.15s;

      .material-icons { font-size: 14px; }

      &:hover {
        border-color: var(--primary);
        color: var(--primary);
        background: rgba(111, 179, 184, 0.06);
      }
    }

    /* ── Typing Indicator ── */
    .typing-indicator {
      display: flex;
      gap: 4px;
      padding: 16px 20px;
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 4px 16px 16px 16px;

      span {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: var(--text-muted);
        animation: typingBounce 1.4s ease-in-out infinite;

        &:nth-child(2) { animation-delay: 0.2s; }
        &:nth-child(3) { animation-delay: 0.4s; }
      }
    }

    @keyframes typingBounce {
      0%, 60%, 100% { transform: translateY(0); opacity: 0.4; }
      30% { transform: translateY(-6px); opacity: 1; }
    }

    /* ── Input Bar ── */
    .chat-input-bar {
      padding: 16px 24px 20px;
      background: var(--background-darker);
    }

    .chat-input-wrapper {
      max-width: 800px;
      margin: 0 auto;
      display: flex;
      align-items: flex-end;
      gap: 8px;
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 16px;
      padding: 8px 8px 8px 20px;
      transition: border-color 0.15s;

      &:focus-within {
        border-color: var(--primary);
      }
    }

    .chat-input-wrapper textarea {
      flex: 1;
      border: none;
      background: none;
      outline: none;
      font-size: 14px;
      line-height: 1.5;
      color: var(--text-primary);
      resize: none;
      max-height: 200px;
      padding: 6px 0;
      font-family: inherit;

      &::placeholder {
        color: var(--text-muted);
      }

      &:disabled {
        opacity: 0.6;
      }
    }

    .send-btn {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 36px;
      height: 36px;
      border: none;
      border-radius: 12px;
      background: var(--primary);
      color: white;
      cursor: pointer;
      flex-shrink: 0;
      transition: all 0.15s;

      .material-icons { font-size: 20px; }

      &:hover:not(:disabled) { background: var(--primary-dark); }
      &:disabled { opacity: 0.4; cursor: not-allowed; }
    }

    /* ── Mobile ── */
    @media (max-width: 768px) {
      .chat-history-panel {
        position: absolute;
        top: 0;
        left: 0;
        bottom: 0;
        z-index: 20;
        transform: translateX(-100%);
        transition: transform 0.2s ease;
        box-shadow: none;

        &.open {
          transform: translateX(0);
          box-shadow: 4px 0 16px rgba(0, 0, 0, 0.1);
        }
      }

      .history-toggle {
        display: flex;
      }

      /* clear the floating toggle so it doesn't overlap the logo/name */
      .chat-space-header {
        padding-left: 56px;
      }
    }
  `]
})
export class SpaceChatComponent implements OnInit, AfterViewChecked {
  @ViewChild('messagesContainer') messagesContainer!: ElementRef<HTMLDivElement>;
  @ViewChild('chatInput') chatInputEl!: ElementRef<HTMLTextAreaElement>;

  space = signal<Space | null>(null);
  contextRepos = signal<Space[]>([]);
  contextLabel = computed(() => {
    const sp = this.space();
    if (!sp) return '';
    if (sp.type !== 'GROUP') return 'Searching this repository';
    const n = this.contextRepos().length;
    if (n === 0) return 'No repositories in this group';
    return `Searching ${n} ${n === 1 ? 'repository' : 'repositories'}`;
  });
  chatHistories = signal<ChatHistory[]>([]);
  currentChat = signal<ChatHistory | null>(null);
  sending = signal(false);
  historiesLoading = signal(false);
  historyOpen = signal(true);
  messageInput = '';

  private shouldScrollToBottom = false;
  private markdownCache = new Map<string, SafeHtml>();

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private aiService: AiService,
    private spacesService: SpacesService,
    private markdownService: MarkdownRenderService,
    private hostRef: ElementRef<HTMLElement>
  ) {}

  ngOnInit(): void {
    this.route.parent?.params.subscribe(params => {
      const parts: string[] = [];
      if (params['path1']) parts.push(params['path1']);
      if (params['path2']) parts.push(params['path2']);
      if (params['path3']) parts.push(params['path3']);
      const fullPath = parts.join('/');
      if (fullPath) {
        this.spacesService.getSpaceByPath(fullPath).subscribe({
          next: (space) => {
            this.space.set(space);
            this.loadChatHistories(space.id);
            this.loadContextRepos(space);
          }
        });
      }
    });
  }

  ngAfterViewChecked(): void {
    if (this.shouldScrollToBottom) {
      this.scrollToBottom();
      this.shouldScrollToBottom = false;
    }
  }

  // Mirrors the backend retrieval scope (EmbeddingService.resolveSpaceIds): a GROUP
  // chats across all descendant repositories, a REPOSITORY across itself. Nesting is
  // at most 2 levels (workspace groups feature), so one level of sub-group expansion covers it.
  private loadContextRepos(space: Space): void {
    if (space.type !== 'GROUP') {
      this.contextRepos.set([]);
      return;
    }
    this.spacesService.getChildren(space.id).subscribe({
      next: (children) => {
        const repos = children.filter(c => c.type === 'REPOSITORY');
        const subGroups = children.filter(c => c.type === 'GROUP');
        if (subGroups.length === 0) {
          this.contextRepos.set(repos);
          return;
        }
        forkJoin(subGroups.map(g => this.spacesService.getChildren(g.id))).subscribe({
          next: (lists) => {
            const nested = lists.flat().filter(c => c.type === 'REPOSITORY');
            this.contextRepos.set([...repos, ...nested]);
          },
          error: () => this.contextRepos.set(repos)
        });
      },
      error: () => this.contextRepos.set([])
    });
  }

  openContextRepo(repo: Space): void {
    this.router.navigate(spaceRoute(repo.fullPath));
  }

  loadChatHistories(spaceId: string): void {
    this.historiesLoading.set(true);
    this.aiService.getChatHistory(spaceId).subscribe({
      next: (histories) => {
        this.chatHistories.set(histories);
        this.historiesLoading.set(false);
      },
      error: () => this.historiesLoading.set(false)
    });
  }

  startNewChat(): void {
    const space = this.space();
    if (!space) return;

    this.currentChat.set({
      id: '',
      spaceId: space.id,
      messages: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
    this.messageInput = '';
    this.historyOpen.set(false);

    // Focus textarea after view updates
    setTimeout(() => this.chatInputEl?.nativeElement?.focus(), 50);
  }

  loadChat(history: ChatHistory): void {
    this.aiService.getChatHistoryById(history.id).subscribe({
      next: (chat) => {
        this.currentChat.set(chat);
        this.shouldScrollToBottom = true;
        this.historyOpen.set(false);
      }
    });
  }

  deleteChat(history: ChatHistory, event: Event): void {
    event.stopPropagation();
    this.aiService.deleteChatHistory(history.id).subscribe({
      next: () => {
        this.chatHistories.update(h => h.filter(c => c.id !== history.id));
        if (this.currentChat()?.id === history.id) {
          this.currentChat.set(null);
        }
      }
    });
  }

  sendMessage(): void {
    if (!this.messageInput.trim() || this.sending()) return;

    const space = this.space();
    if (!space) return;

    const message = this.messageInput;
    this.messageInput = '';

    // Reset textarea height
    if (this.chatInputEl) {
      this.chatInputEl.nativeElement.style.height = 'auto';
    }

    // Ensure we have a current chat
    let chat = this.currentChat();
    if (!chat) {
      chat = {
        id: '',
        spaceId: space.id,
        messages: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
    }

    // Optimistic: add user message
    chat = {
      ...chat,
      messages: [...chat.messages, {
        role: 'user',
        content: message,
        timestamp: new Date().toISOString()
      }]
    };
    this.currentChat.set(chat);
    this.shouldScrollToBottom = true;
    this.sending.set(true);

    this.aiService.chat(space.id, message, chat.id || undefined).subscribe({
      next: (response) => {
        const updated = this.currentChat();
        if (updated) {
          this.currentChat.set({
            ...updated,
            id: response.chatHistoryId || updated.id,
            messages: [...updated.messages, {
              role: 'assistant',
              content: response.message,
              sources: response.sources,
              timestamp: new Date().toISOString()
            }]
          });
        }
        this.sending.set(false);
        this.shouldScrollToBottom = true;
        this.loadChatHistories(space.id);
      },
      error: () => {
        this.sending.set(false);
      }
    });
  }

  onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      this.sendMessage();
    }
  }

  autoGrow(event: Event): void {
    const textarea = event.target as HTMLTextAreaElement;
    textarea.style.height = 'auto';
    textarea.style.height = Math.min(textarea.scrollHeight, 200) + 'px';
  }

  renderMarkdown(content: string): SafeHtml {
    let cached = this.markdownCache.get(content);
    if (!cached) {
      cached = this.markdownService.renderInline(content);
      this.markdownCache.set(content, cached);
    }
    // Defer mermaid rendering until Angular has flushed the new innerHTML.
    setTimeout(() => this.markdownService.runMermaid(this.hostRef.nativeElement), 0);
    return cached;
  }

  navigateToSource(source: string): void {
    const space = this.space();
    if (space) {
      this.router.navigate(spaceRoute(space.fullPath, 'doc'), {
        queryParams: { path: source }
      });
    }
  }

  formatSourceName(source: string): string {
    const parts = source.split('/');
    return parts[parts.length - 1].replace(/\.md$/, '');
  }

  formatDate(dateString: string): string {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return `${diffDays} days ago`;
    return date.toLocaleDateString();
  }

  private scrollToBottom(): void {
    const el = this.messagesContainer?.nativeElement;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }
}
