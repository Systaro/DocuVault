import { Component, OnInit, OnDestroy, signal, ViewChild, ElementRef, HostListener } from '@angular/core';
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
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { SpacesService, Space } from '../../core/api/spaces.service';
import { DocumentsService, DocumentContent } from '../../core/api/documents.service';
import { AiService } from '../../core/api/ai.service';
import { AuthService } from '../../core/auth/auth.service';
import { GitService } from '../../core/api/git.service';
import { ShareLinkDialogComponent } from '../../shared/components/share-link-dialog.component';
import { Subject, debounceTime, takeUntil } from 'rxjs';
import TurndownService from 'turndown';
import { marked } from 'marked';

@Component({
  selector: 'app-editor',
  standalone: true,
  imports: [CommonModule, FormsModule, ShareLinkDialogComponent],
  template: `
    <div class="h-full flex flex-col">
      <!-- TODO: Once the markdown saving is fixed, re-enable the toolbar and editing -->
      @if (!isPreviewFile()) {
      <!-- Toolbar (read-only mode) -->
      <div class="editor-toolbar">
        <div class="flex items-center gap-2">
          <span class="text-sm text-amber-600 font-medium">Read-only mode — editing temporarily disabled</span>
        </div>
        <div class="flex items-center gap-2">
          @if (documentPath) {
            <div class="relative">
              <button
                (click)="showActionMenu.set(!showActionMenu()); $event.stopPropagation()"
                class="editor-icon-btn"
                title="Actions"
              >
                <svg class="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                  <circle cx="12" cy="5" r="2"/>
                  <circle cx="12" cy="12" r="2"/>
                  <circle cx="12" cy="19" r="2"/>
                </svg>
              </button>
              @if (showActionMenu()) {
                <div class="action-menu">
                  <button class="action-menu-item" (click)="showShareDialog.set(true); showActionMenu.set(false)">
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z"></path>
                    </svg>
                    Create a public share
                  </button>
                  <button class="action-menu-item" (click)="exportAsPdf(); showActionMenu.set(false)">
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>
                    </svg>
                    Export as PDF
                  </button>
                  @if (getGitUrl()) {
                    <button class="action-menu-item" (click)="copyGitLink(); showActionMenu.set(false)">
                      <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"/>
                      </svg>
                      {{ gitLinkCopied() ? 'Copied!' : 'Get git link' }}
                    </button>
                  }
                </div>
              }
            </div>
          }
        </div>
      </div>

      }

      @if (isPreviewFile()) {
        <!-- File Preview -->
        <div class="flex-1 overflow-y-auto editor-bg">
          <div class="preview-container">
            <div class="preview-header">
              <div class="preview-filename">{{ documentPath.split('/').pop() }}</div>
              <div class="relative">
                <button
                  (click)="showActionMenu.set(!showActionMenu()); $event.stopPropagation()"
                  class="editor-icon-btn"
                  title="Actions"
                >
                  <svg class="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                    <circle cx="12" cy="5" r="2"/>
                    <circle cx="12" cy="12" r="2"/>
                    <circle cx="12" cy="19" r="2"/>
                  </svg>
                </button>
                @if (showActionMenu()) {
                  <div class="action-menu">
                    <button class="action-menu-item" (click)="showShareDialog.set(true); showActionMenu.set(false)">
                      <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z"></path>
                      </svg>
                      Create a public share
                    </button>
                    <button class="action-menu-item" (click)="exportAsPdf(); showActionMenu.set(false)">
                      <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>
                      </svg>
                      Export as PDF
                    </button>
                    @if (getGitUrl()) {
                      <button class="action-menu-item" (click)="copyGitLink(); showActionMenu.set(false)">
                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"/>
                        </svg>
                        {{ gitLinkCopied() ? 'Copied!' : 'Get git link' }}
                      </button>
                    }
                  </div>
                }
              </div>
            </div>
            @if (previewType() === 'html') {
              <iframe [src]="safePreviewUrl()" class="preview-iframe" sandbox="allow-scripts allow-same-origin"></iframe>
            } @else {
              <img [src]="previewUrl()" [alt]="documentPath.split('/').pop()" class="preview-image" />
            }
          </div>
        </div>
      } @else {
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
              <!-- Document Title (read-only until markdown saving is fixed) -->
              <input
                type="text"
                [(ngModel)]="documentTitle"
                placeholder="Untitled"
                readonly
                class="editor-title"
              />

              <!-- TipTap Editor Container -->
              <div
                #editorElement
                class="prose prose-lg max-w-none"
              ></div>
            }
          </div>
        </div>
      }

      <!-- Chat Sidebar Toggle -->
      <button
        (click)="showChat.set(!showChat())"
        class="fixed bottom-6 right-6 w-12 h-12 bg-primary-600 text-white rounded-full shadow-lg hover:bg-primary-700 flex items-center justify-center"
      >
        <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z"></path>
        </svg>
      </button>

      @if (showShareDialog() && space() && documentPath) {
        <app-share-link-dialog
          [spaceId]="space()!.id"
          [filePath]="documentPath"
          (close)="showShareDialog.set(false)"
        />
      }
    </div>
  `,
  styles: [`
    :host {
      display: block;
      height: 100%;
      position: relative;
    }

    .editor-bg {
      background: var(--background-darker);
    }

    .editor-toolbar {
      border-bottom: 1px solid var(--border);
      background: var(--surface);
      padding: 8px 16px;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }

    .editor-icon-btn {
      padding: 8px;
      border-radius: 6px;
      border: none;
      background: none;
      color: var(--text-secondary);
      cursor: pointer;
      display: flex;
      align-items: center;

      &:hover {
        background: var(--background);
      }
    }

    .editor-title {
      width: 100%;
      font-size: 1.875rem;
      font-weight: 700;
      color: var(--text-primary);
      border: none;
      outline: none;
      margin-bottom: 24px;
      background: transparent;
      cursor: default;
    }

    .paper {
      background: var(--surface);
      min-height: calc(100vh - 120px);
      margin-top: 24px;
      margin-bottom: 24px;
      border-radius: 4px;
      box-shadow: var(--shadow-sm);
    }

    .preview-container {
      display: flex;
      flex-direction: column;
      align-items: center;
      padding: 2rem;
      gap: 1rem;
    }

    .preview-header {
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }

    .preview-filename {
      font-size: 0.875rem;
      color: var(--text-muted);
      font-weight: 500;
    }

    .preview-image {
      max-width: 100%;
      max-height: calc(100vh - 160px);
      object-fit: contain;
      border-radius: 4px;
      box-shadow: var(--shadow-sm);
    }

    .preview-iframe {
      width: 100%;
      flex: 1;
      min-height: calc(100vh - 160px);
      border: none;
      border-radius: 4px;
      background: var(--surface);
      box-shadow: var(--shadow-sm);
    }

    .action-menu {
      position: absolute;
      right: 0;
      top: 100%;
      margin-top: 4px;
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 8px;
      box-shadow: var(--shadow-lg);
      min-width: 200px;
      z-index: 50;
      padding: 4px;
    }

    .action-menu-item {
      display: flex;
      align-items: center;
      gap: 8px;
      width: 100%;
      padding: 8px 12px;
      font-size: 0.875rem;
      color: var(--text-primary);
      border: none;
      background: none;
      border-radius: 6px;
      cursor: pointer;
      white-space: nowrap;
      text-align: left;
    }

    .action-menu-item:hover {
      background: var(--background);
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

  private static readonly IMAGE_EXTENSIONS = new Set([
    'jpg', 'jpeg', 'png', 'gif', 'svg', 'webp', 'bmp', 'ico', 'avif'
  ]);
  private static readonly HTML_EXTENSIONS = new Set(['html', 'htm']);

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
  showShareDialog = signal(false);
  showActionMenu = signal(false);
  gitLinkCopied = signal(false);
  isPreviewFile = signal(false);
  previewType = signal<'image' | 'html'>('image');
  previewUrl = signal('');
  safePreviewUrl = signal<SafeResourceUrl>('');

  constructor(
    private route: ActivatedRoute,
    private spacesService: SpacesService,
    private documentsService: DocumentsService,
    private aiService: AiService,
    private gitService: GitService,
    private authService: AuthService,
    private sanitizer: DomSanitizer
  ) {
    // TODO: Once the markdown saving is fixed, re-enable auto-save and editing
    // Auto-save setup (disabled — saving currently destroys markdown)
    // this.autoSave$.pipe(
    //   debounceTime(2000),
    //   takeUntil(this.destroy$)
    // ).subscribe(() => this.saveDocument());
  }

  @HostListener('document:click')
  onDocumentClick(): void {
    this.showActionMenu.set(false);
  }

  getGitUrl(): string | null {
    const s = this.space();
    if (!s?.gitlabUrl || !this.documentPath) return null;
    const base = s.gitlabUrl.replace(/\/+$/, '');
    return `${base}/-/blob/${s.branch}/${this.documentPath}`;
  }

  copyGitLink(): void {
    const url = this.getGitUrl();
    if (!url) return;
    navigator.clipboard.writeText(url);
    this.gitLinkCopied.set(true);
    setTimeout(() => this.gitLinkCopied.set(false), 2000);
  }

  exportAsPdf(): void {
    const title = this.documentTitle || this.documentPath.split('/').pop() || 'Document';

    let bodyContent = '';
    if (this.isPreviewFile()) {
      if (this.previewType() === 'image') {
        bodyContent = `<img src="${window.location.origin}${this.previewUrl()}" style="max-width:100%;height:auto;" />`;
      } else {
        bodyContent = `<iframe src="${window.location.origin}${this.previewUrl()}" style="width:100%;height:100vh;border:none;"></iframe>`;
      }
    } else if (this.editor) {
      bodyContent = `<h1>${this.escapeHtml(title)}</h1>${this.editor.getHTML()}`;
    }

    const printWindow = window.open('', '_blank');
    if (!printWindow) return;

    printWindow.document.write(`<!DOCTYPE html>
<html><head>
<meta charset="utf-8">
<title>${this.escapeHtml(title)}</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 800px; margin: 0 auto; padding: 40px 24px; color: #1a1a1a; line-height: 1.6; }
  h1 { font-size: 1.8em; margin-bottom: 0.5em; }
  h2 { font-size: 1.4em; margin-top: 1.5em; }
  h3 { font-size: 1.2em; margin-top: 1.2em; }
  pre { background: #f5f5f5; padding: 12px 16px; border-radius: 6px; overflow-x: auto; font-size: 0.9em; }
  code { background: #f5f5f5; padding: 2px 4px; border-radius: 3px; font-size: 0.9em; }
  pre code { background: none; padding: 0; }
  blockquote { border-left: 3px solid #ddd; margin-left: 0; padding-left: 16px; color: #555; }
  table { border-collapse: collapse; width: 100%; margin: 1em 0; }
  th, td { border: 1px solid #ddd; padding: 8px 12px; text-align: left; }
  th { background: #f5f5f5; font-weight: 600; }
  img { max-width: 100%; height: auto; }
  ul[data-type="taskList"] { list-style: none; padding-left: 0; }
  ul[data-type="taskList"] li { display: flex; align-items: baseline; gap: 8px; }
  ul[data-type="taskList"] li::before { content: "☐"; }
  ul[data-type="taskList"] li[data-checked="true"]::before { content: "☑"; }
  a { color: #2563eb; }
  @media print { body { padding: 0; } }
</style>
</head><body>${bodyContent}</body></html>`);
    printWindow.document.close();
    printWindow.onload = () => {
      printWindow.print();
    };
  }

  private escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
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
        const ext = path.split('.').pop()?.toLowerCase() || '';
        if (EditorComponent.IMAGE_EXTENSIONS.has(ext)) {
          this.isPreviewFile.set(true);
          this.previewType.set('image');
          this.loading.set(false);
          const space = this.space();
          if (space) {
            this.previewUrl.set(`/api/spaces/${space.id}/files/${path}`);
          }
        } else if (EditorComponent.HTML_EXTENSIONS.has(ext)) {
          this.isPreviewFile.set(true);
          this.previewType.set('html');
          this.loading.set(false);
          const space = this.space();
          if (space) {
            const url = `/api/spaces/${space.id}/files/${path}`;
            this.previewUrl.set(url);
            this.safePreviewUrl.set(this.sanitizer.bypassSecurityTrustResourceUrl(url));
          }
        } else {
          this.isPreviewFile.set(false);
          if (this.space()) {
            this.loadDocument();
          }
        }
      } else {
        this.isPreviewFile.set(false);
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
        if (this.isPreviewFile()) {
          const url = `/api/spaces/${space.id}/files/${this.documentPath}`;
          this.previewUrl.set(url);
          if (this.previewType() === 'html') {
            this.safePreviewUrl.set(this.sanitizer.bypassSecurityTrustResourceUrl(url));
          }
        } else if (this.documentPath) {
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
    let htmlContent = marked.parse(content) as string;

    // Rewrite relative image src to serve from API, resolved relative to the document's directory
    const space = this.space();
    if (space) {
      const docDir = this.documentPath ? this.documentPath.substring(0, this.documentPath.lastIndexOf('/') + 1) : '';
      htmlContent = htmlContent.replace(
        /(<img\s[^>]*src=")(?!https?:\/\/|\/api\/)([^"]+)(")/g,
        (_match, pre, src, post) => {
          const resolved = this.resolveRelativePath(docDir + src);
          return `${pre}/api/spaces/${space.id}/files/${resolved}${post}`;
        }
      );
    }

    // Destroy existing editor if any
    this.editor?.destroy();

    const el = this.editorElement?.nativeElement;
    if (!el) return;

    // TODO: Once the markdown saving is fixed, set editable back to true
    this.editor = new Editor({
      element: el,
      editable: false,
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
      // TODO: Once the markdown saving is fixed, re-enable onUpdate
      // onUpdate: () => {
      //   this.hasChanges.set(true);
      //   this.lastSaved.set(false);
      //   this.autoSave$.next();
      // }
    });
  }

  saveDocument(): void {
    const space = this.space();
    if (!space || !this.editor || this.saving()) return;

    let html = this.editor.getHTML();
    // Restore relative image paths before converting to markdown
    html = html.replace(
      /(<img\s[^>]*src=")\/api\/spaces\/[^/]+\/files\/([^"]+)(")/g,
      '$1$2$3'
    );
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

    let html = this.editor.getHTML();
    html = html.replace(
      /(<img\s[^>]*src=")\/api\/spaces\/[^/]+\/files\/([^"]+)(")/g,
      '$1$2$3'
    );
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

  private resolveRelativePath(path: string): string {
    const parts = path.split('/');
    const resolved: string[] = [];
    for (const part of parts) {
      if (part === '..') {
        resolved.pop();
      } else if (part !== '.' && part !== '') {
        resolved.push(part);
      }
    }
    return resolved.join('/');
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
