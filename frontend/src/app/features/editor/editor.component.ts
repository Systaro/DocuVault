import { Component, OnInit, OnDestroy, signal, ViewChild, ElementRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import Link from '@tiptap/extension-link';
import Image from '@tiptap/extension-image';
import Table from '@tiptap/extension-table';
import TableRow from '@tiptap/extension-table-row';
import TableCell from '@tiptap/extension-table-cell';
import TableHeader from '@tiptap/extension-table-header';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import Highlight from '@tiptap/extension-highlight';
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
import { common, createLowlight } from 'lowlight';
import { SpacesService, Space } from '../../core/api/spaces.service';
import { DocumentsService, DocumentContent } from '../../core/api/documents.service';
import { AiService } from '../../core/api/ai.service';
import { AuthService } from '../../core/auth/auth.service';
import { GitService } from '../../core/api/git.service';
import { Subject, debounceTime, takeUntil } from 'rxjs';
import TurndownService from 'turndown';
import { marked } from 'marked';

@Component({
  selector: 'app-editor',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="h-full flex flex-col">
      <!-- Toolbar -->
      <div class="border-b border-gray-200 bg-white px-4 py-2 flex items-center justify-between">
        <div class="flex items-center gap-1">
          <!-- Text formatting -->
          <button
            (click)="toggleBold()"
            [class.bg-gray-200]="isActive('bold')"
            class="p-2 rounded hover:bg-gray-100"
            title="Bold"
          >
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 4h8a4 4 0 014 4 4 4 0 01-4 4H6z"></path>
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 12h9a4 4 0 014 4 4 4 0 01-4 4H6z"></path>
            </svg>
          </button>
          <button
            (click)="toggleItalic()"
            [class.bg-gray-200]="isActive('italic')"
            class="p-2 rounded hover:bg-gray-100"
            title="Italic"
          >
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 4h4m-2 0v16m4-16h-4m0 16h4"></path>
            </svg>
          </button>
          <button
            (click)="toggleStrike()"
            [class.bg-gray-200]="isActive('strike')"
            class="p-2 rounded hover:bg-gray-100"
            title="Strikethrough"
          >
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 10H3M21 14H3m4-4v8"></path>
            </svg>
          </button>
          <button
            (click)="toggleCode()"
            [class.bg-gray-200]="isActive('code')"
            class="p-2 rounded hover:bg-gray-100"
            title="Code"
          >
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4"></path>
            </svg>
          </button>

          <div class="w-px h-6 bg-gray-300 mx-2"></div>

          <!-- Headings -->
          <button
            (click)="setHeading(1)"
            [class.bg-gray-200]="isActive('heading', { level: 1 })"
            class="p-2 rounded hover:bg-gray-100 text-sm font-bold"
            title="Heading 1"
          >
            H1
          </button>
          <button
            (click)="setHeading(2)"
            [class.bg-gray-200]="isActive('heading', { level: 2 })"
            class="p-2 rounded hover:bg-gray-100 text-sm font-bold"
            title="Heading 2"
          >
            H2
          </button>
          <button
            (click)="setHeading(3)"
            [class.bg-gray-200]="isActive('heading', { level: 3 })"
            class="p-2 rounded hover:bg-gray-100 text-sm font-bold"
            title="Heading 3"
          >
            H3
          </button>

          <div class="w-px h-6 bg-gray-300 mx-2"></div>

          <!-- Lists -->
          <button
            (click)="toggleBulletList()"
            [class.bg-gray-200]="isActive('bulletList')"
            class="p-2 rounded hover:bg-gray-100"
            title="Bullet List"
          >
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16"></path>
            </svg>
          </button>
          <button
            (click)="toggleOrderedList()"
            [class.bg-gray-200]="isActive('orderedList')"
            class="p-2 rounded hover:bg-gray-100"
            title="Ordered List"
          >
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 20l4-16m2 16l4-16M6 9h14M4 15h14"></path>
            </svg>
          </button>
          <button
            (click)="toggleTaskList()"
            [class.bg-gray-200]="isActive('taskList')"
            class="p-2 rounded hover:bg-gray-100"
            title="Task List"
          >
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4"></path>
            </svg>
          </button>

          <div class="w-px h-6 bg-gray-300 mx-2"></div>

          <!-- Block types -->
          <button
            (click)="toggleBlockquote()"
            [class.bg-gray-200]="isActive('blockquote')"
            class="p-2 rounded hover:bg-gray-100"
            title="Quote"
          >
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z"></path>
            </svg>
          </button>
          <button
            (click)="toggleCodeBlock()"
            [class.bg-gray-200]="isActive('codeBlock')"
            class="p-2 rounded hover:bg-gray-100"
            title="Code Block"
          >
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"></path>
            </svg>
          </button>

          <div class="w-px h-6 bg-gray-300 mx-2"></div>

          <!-- AI Features -->
          <button
            (click)="showAiMenu.set(!showAiMenu())"
            class="p-2 rounded hover:bg-gray-100 flex items-center gap-1"
            title="AI Assistant"
          >
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"></path>
            </svg>
            <span class="text-sm">AI</span>
          </button>
        </div>

        <div class="flex items-center gap-2">
          @if (saving()) {
            <span class="text-sm text-gray-500">Saving...</span>
          } @else if (lastSaved()) {
            <span class="text-sm text-gray-500">Saved</span>
          }
          <button
            (click)="saveAndCommit()"
            [disabled]="!hasChanges() || saving()"
            class="btn btn-primary text-sm"
          >
            Save & Commit
          </button>
        </div>
      </div>

      <!-- AI Menu Dropdown -->
      @if (showAiMenu()) {
        <div class="absolute top-16 left-4 z-50 bg-white border border-gray-200 rounded-lg shadow-lg p-2 w-48">
          <button
            (click)="aiAction('IMPROVE')"
            class="w-full text-left px-3 py-2 text-sm hover:bg-gray-100 rounded"
          >
            Improve writing
          </button>
          <button
            (click)="aiAction('EXPAND')"
            class="w-full text-left px-3 py-2 text-sm hover:bg-gray-100 rounded"
          >
            Expand content
          </button>
          <button
            (click)="aiAction('SUMMARIZE')"
            class="w-full text-left px-3 py-2 text-sm hover:bg-gray-100 rounded"
          >
            Summarize
          </button>
          <button
            (click)="aiAction('FIX_GRAMMAR')"
            class="w-full text-left px-3 py-2 text-sm hover:bg-gray-100 rounded"
          >
            Fix grammar
          </button>
        </div>
      }

      <!-- Editor Area -->
      <div class="flex-1 overflow-y-auto editor-bg">
        <div class="max-w-4xl mx-auto px-8 py-6 paper">
          @if (loading()) {
            <div class="flex items-center justify-center py-12">
              <svg class="animate-spin h-8 w-8 text-primary-600" fill="none" viewBox="0 0 24 24">
                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
              </svg>
            </div>
          } @else {
            <!-- Document Title -->
            <input
              type="text"
              [(ngModel)]="documentTitle"
              placeholder="Untitled"
              class="w-full text-3xl font-bold text-gray-900 border-none outline-none mb-6 bg-transparent"
            />

            <!-- TipTap Editor Container -->
            <div
              #editorElement
              class="prose prose-lg max-w-none"
            ></div>
          }
        </div>
      </div>

      <!-- Chat Sidebar Toggle -->
      <button
        (click)="showChat.set(!showChat())"
        class="fixed bottom-6 right-6 w-12 h-12 bg-primary-600 text-white rounded-full shadow-lg hover:bg-primary-700 flex items-center justify-center"
      >
        <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z"></path>
        </svg>
      </button>
    </div>
  `,
  styles: [`
    :host {
      display: block;
      height: 100%;
      position: relative;
    }

    .editor-bg {
      background: var(--background, #f0f2f5);
    }

    .paper {
      background: white;
      min-height: calc(100vh - 120px);
      margin-top: 24px;
      margin-bottom: 24px;
      border-radius: 4px;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08), 0 1px 2px rgba(0, 0, 0, 0.06);
    }
  `]
})
export class EditorComponent implements OnInit, OnDestroy {
  private editor: Editor | null = null;
  private destroy$ = new Subject<void>();
  private turndownService = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
    fence: '```',
    bulletListMarker: '-',
  });
  private autoSave$ = new Subject<void>();
  @ViewChild('editorElement') editorElement!: ElementRef<HTMLElement>;

  space = signal<Space | null>(null);
  document = signal<DocumentContent | null>(null);
  documentTitle = '';
  documentPath = '';
  loading = signal(true);
  saving = signal(false);
  lastSaved = signal(false);
  hasChanges = signal(false);
  showAiMenu = signal(false);
  showChat = signal(false);

  constructor(
    private route: ActivatedRoute,
    private spacesService: SpacesService,
    private documentsService: DocumentsService,
    private aiService: AiService,
    private gitService: GitService,
    private authService: AuthService
  ) {
    // Auto-save setup
    this.autoSave$.pipe(
      debounceTime(2000),
      takeUntil(this.destroy$)
    ).subscribe(() => this.saveDocument());
  }

  ngOnInit(): void {
    // Load space from parent route params (path1/path2/path3)
    this.route.parent?.paramMap.subscribe(params => {
      const parts: string[] = [];
      if (params.get('path1')) parts.push(params.get('path1')!);
      if (params.get('path2')) parts.push(params.get('path2')!);
      if (params.get('path3')) parts.push(params.get('path3')!);
      const fullPath = parts.join('/');
      if (fullPath) {
        this.loadSpace(fullPath);
      }
    });

    // Get document path from query params
    this.route.queryParamMap.subscribe(params => {
      const path = params.get('path');
      if (path) {
        this.documentPath = path;
        if (this.space()) {
          this.loadDocument();
        }
      } else {
        this.initializeNewDocument();
      }
    });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
    this.editor?.destroy();
  }

  loadSpace(fullPath: string): void {
    this.spacesService.getSpaceByPath(fullPath).subscribe({
      next: (space) => {
        this.space.set(space);
        if (this.documentPath) {
          this.loadDocument();
        }
      }
    });
  }

  loadDocument(): void {
    const space = this.space();
    if (!space || !this.documentPath) return;

    this.loading.set(true);
    this.documentsService.getDocument(space.id, this.documentPath).subscribe({
      next: (doc) => {
        this.document.set(doc);
        this.documentTitle = doc.title || '';
        // Strip leading H1 if it matches the title to avoid duplicate heading
        let content = doc.content;
        const h1Match = content.match(/^#\s+(.+)\n*/);
        if (h1Match && h1Match[1].trim() === this.documentTitle.trim()) {
          content = content.substring(h1Match[0].length);
        }
        this.loading.set(false);
        setTimeout(() => this.initializeEditor(content));
      },
      error: () => {
        this.initializeNewDocument();
      }
    });
  }

  initializeNewDocument(): void {
    this.documentTitle = '';
    this.loading.set(false);
    setTimeout(() => this.initializeEditor(''));
  }

  initializeEditor(content: string): void {
    const lowlight = createLowlight(common);

    // Convert markdown to HTML for editor
    const htmlContent = marked.parse(content) as string;

    // Destroy existing editor if any
    this.editor?.destroy();

    const el = this.editorElement?.nativeElement;
    if (!el) return;

    this.editor = new Editor({
      element: el,
      extensions: [
        StarterKit.configure({
          codeBlock: false
        }),
        Placeholder.configure({
          placeholder: 'Start writing your documentation...'
        }),
        Link.configure({
          openOnClick: false
        }),
        Image,
        Table.configure({
          resizable: true
        }),
        TableRow,
        TableHeader,
        TableCell,
        TaskList,
        TaskItem.configure({
          nested: true
        }),
        Highlight,
        CodeBlockLowlight.configure({
          lowlight
        })
      ],
      content: htmlContent,
      onUpdate: () => {
        this.hasChanges.set(true);
        this.lastSaved.set(false);
        this.autoSave$.next();
      }
    });
  }

  saveDocument(): void {
    const space = this.space();
    if (!space || !this.editor || this.saving()) return;

    const html = this.editor.getHTML();
    const markdown = this.turndownService.turndown(html);

    this.saving.set(true);

    if (this.documentPath) {
      // Update existing document
      this.documentsService.updateDocument(space.id, this.documentPath, {
        title: this.documentTitle,
        content: markdown
      }).subscribe({
        next: (doc) => {
          this.document.set(doc);
          this.saving.set(false);
          this.lastSaved.set(true);
          this.hasChanges.set(false);
        },
        error: () => {
          this.saving.set(false);
        }
      });
    } else {
      // Create new document
      const path = this.generatePath();
      this.documentsService.createDocument(space.id, {
        path,
        title: this.documentTitle,
        content: markdown
      }).subscribe({
        next: (doc) => {
          this.document.set(doc);
          this.documentPath = path;
          this.saving.set(false);
          this.lastSaved.set(true);
          this.hasChanges.set(false);
        },
        error: () => {
          this.saving.set(false);
        }
      });
    }
  }

  saveAndCommit(): void {
    const space = this.space();
    const user = this.authService.user();
    if (!space || !this.editor || !user) return;

    const html = this.editor.getHTML();
    const markdown = this.turndownService.turndown(html);

    this.saving.set(true);

    const path = this.documentPath || this.generatePath();

    this.documentsService.updateDocument(space.id, path, {
      title: this.documentTitle,
      content: markdown,
      autoCommit: true,
      commitMessage: `Update ${this.documentTitle || path}`
    }).subscribe({
      next: (doc) => {
        this.document.set(doc);
        this.documentPath = path;
        this.saving.set(false);
        this.lastSaved.set(true);
        this.hasChanges.set(false);
      },
      error: () => {
        this.saving.set(false);
      }
    });
  }

  generatePath(): string {
    const title = this.documentTitle || 'untitled';
    const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    return `docs/${slug}.md`;
  }

  // Toolbar actions
  toggleBold(): void {
    this.editor?.chain().focus().toggleBold().run();
  }

  toggleItalic(): void {
    this.editor?.chain().focus().toggleItalic().run();
  }

  toggleStrike(): void {
    this.editor?.chain().focus().toggleStrike().run();
  }

  toggleCode(): void {
    this.editor?.chain().focus().toggleCode().run();
  }

  setHeading(level: 1 | 2 | 3): void {
    this.editor?.chain().focus().toggleHeading({ level }).run();
  }

  toggleBulletList(): void {
    this.editor?.chain().focus().toggleBulletList().run();
  }

  toggleOrderedList(): void {
    this.editor?.chain().focus().toggleOrderedList().run();
  }

  toggleTaskList(): void {
    this.editor?.chain().focus().toggleTaskList().run();
  }

  toggleBlockquote(): void {
    this.editor?.chain().focus().toggleBlockquote().run();
  }

  toggleCodeBlock(): void {
    this.editor?.chain().focus().toggleCodeBlock().run();
  }

  isActive(name: string, attributes?: Record<string, unknown>): boolean {
    return this.editor?.isActive(name, attributes) ?? false;
  }

  aiAction(type: string): void {
    this.showAiMenu.set(false);

    const { from, to } = this.editor?.state.selection ?? { from: 0, to: 0 };
    const selectedText = this.editor?.state.doc.textBetween(from, to, ' ') ?? '';

    if (!selectedText) {
      alert('Please select some text first');
      return;
    }

    this.aiService.suggest(selectedText, type).subscribe({
      next: (response) => {
        if (response.suggestion) {
          this.editor?.chain().focus().deleteRange({ from, to }).insertContent(response.suggestion).run();
        }
      }
    });
  }
}
