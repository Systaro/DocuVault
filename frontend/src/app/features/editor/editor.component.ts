import { Component, OnInit, OnDestroy, signal, computed, ViewChild, ElementRef, HostListener, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
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
import { DomSanitizer, SafeResourceUrl, SafeHtml } from '@angular/platform-browser';
import { MarkdownRenderService } from '../../shared/services/markdown-render.service';
import { DataFileRenderService } from '../../shared/services/data-file-render.service';
import { handleMarkdownClick } from '../../shared/utils/markdown-link-handler';
import { DocumentSettingsService } from '../../core/api/document-settings.service';
import { SpacesService, Space } from '../../core/api/spaces.service';
import { DocumentsService, DocumentContent } from '../../core/api/documents.service';
import { DocumentHistoryService, DocumentVersion } from '../../core/api/document-history.service';
import { CapabilitiesService } from '../../core/capabilities/capabilities.service';
import { AnnotationsService, AnnotationPermission } from '../../core/api/annotations.service';
import { AiService, AiEditResult } from '../../core/api/ai.service';
import { isAiEditable } from '../../shared/utils/file-utils';
import { AiEditDialogComponent } from '../../shared/components/ai-edit-dialog.component';
import { AiEditStepBackComponent, AiEditUndoState } from '../../shared/components/ai-edit-step-back.component';
import { AuthService } from '../../core/auth/auth.service';
import { GitService } from '../../core/api/git.service';
import { ShareLinkDialogComponent } from '../../shared/components/share-link-dialog.component';
import { AnnotationOverlayComponent } from '../../shared/components/annotation-overlay.component';
import { ToastService } from '../../shared/services/toast.service';
import { StateExportService } from '../../shared/services/state-export.service';
import { ExportStateDialogComponent } from '../../shared/components/export-state-dialog.component';
import { DisplayPrefsService } from '../../shared/services/display-prefs.service';
import { SpaceRoutePipe } from '../../shared/pipes/space-route.pipe';
import { spaceRoute } from '../../shared/utils/route-utils';
import { mergeMarkdownEdits } from '../../shared/utils/markdown-merge';
import { Subject, debounceTime, takeUntil } from 'rxjs';
import TurndownService from 'turndown';
import { tables as turndownTables } from 'turndown-plugin-gfm';
import { marked } from 'marked';

/**
 * Highlight with a persisted colour. TipTap's stock multicolor renderHTML also
 * emits `color: inherit` inline, which pins the text colour to the theme's body
 * colour — near-white in dark mode, illegible on the light pastel swatches.
 * We drop that inline colour and let CSS (`mark` under `.ProseMirror,
 * .markdown-readonly`) set a fixed dark text colour that reads in both themes.
 * `data-color` is kept so the exact swatch value round-trips through Markdown.
 */
const ColorHighlight = Highlight.extend({
  addAttributes() {
    return {
      color: {
        default: null,
        parseHTML: (element) =>
          element.getAttribute('data-color') || (element as HTMLElement).style.backgroundColor || null,
        renderHTML: (attributes) => {
          if (!attributes['color']) return {};
          return {
            'data-color': attributes['color'],
            style: `background-color: ${attributes['color']}`,
          };
        },
      },
    };
  },
});

/** One renderable line of a parsed unified diff. */
interface DiffLine {
  type: 'add' | 'del' | 'ctx' | 'hunk';
  text: string;
}

@Component({
  selector: 'app-editor',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, SpaceRoutePipe, ShareLinkDialogComponent, AnnotationOverlayComponent, AiEditDialogComponent, AiEditStepBackComponent, ExportStateDialogComponent],
  template: `
    <div class="h-full flex flex-col">
      @if (!isPreviewFile()) {
      <div class="editor-breadcrumb-row">
        @if (space()) {
          <a [routerLink]="space()!.fullPath | spaceRoute" class="editor-crumb">{{ space()!.name }}</a>
          @for (seg of fileBreadcrumb(); track seg.path) {
            <span class="editor-crumb-sep">/</span>
            <a
              [routerLink]="space()!.fullPath | spaceRoute"
              [queryParams]="{ path: seg.path }"
              class="editor-crumb"
            >{{ prefs.prettify(seg.label, true) }}</a>
          }
          @if (documentPath) {
            <span class="editor-crumb-sep">/</span>
            <span class="editor-crumb-active">{{ prefs.prettify(documentPath.split('/').pop() ?? '', false) }}</span>
          }
        }
      </div>
      <div class="editor-toolbar">
        @if (showEditor()) {
          <!-- Editing toolbar (shown only in edit mode) -->
          <div class="flex items-center gap-1">
            <button class="editor-icon-btn" [class.active]="isActive('bold')" (click)="toggleBold()" title="Bold"><b>B</b></button>
            <button class="editor-icon-btn" [class.active]="isActive('italic')" (click)="toggleItalic()" title="Italic"><i>I</i></button>
            <button class="editor-icon-btn" [class.active]="isActive('strike')" (click)="toggleStrike()" title="Strikethrough"><s>S</s></button>
            <button class="editor-icon-btn" [class.active]="isActive('code')" (click)="toggleCode()" title="Inline code">
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4"/></svg>
            </button>
            <div class="relative">
              <button
                class="editor-icon-btn"
                [class.active]="isActive('highlight')"
                (click)="showHighlightMenu.set(!showHighlightMenu()); $event.stopPropagation()"
                title="Highlight color"
              >
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                        d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"/>
                </svg>
              </button>
              @if (showHighlightMenu()) {
                <div class="action-menu action-menu--left highlight-menu" (click)="$event.stopPropagation()">
                  <div class="highlight-swatches">
                    @for (c of highlightColors; track c.value) {
                      <button
                        type="button"
                        class="highlight-swatch"
                        [class.active]="isActive('highlight', { color: c.value })"
                        [style.background-color]="c.value"
                        [title]="c.name"
                        (click)="setHighlight(c.value)"
                      ></button>
                    }
                  </div>
                  <div class="action-menu-divider"></div>
                  <button class="action-menu-item" [disabled]="!isActive('highlight')" (click)="unsetHighlight()">
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>
                    Remove highlight
                  </button>
                </div>
              }
            </div>
            <div class="toolbar-divider"></div>
            <button class="editor-icon-btn" [class.active]="isActive('heading', {level:1})" (click)="setHeading(1)" title="Heading 1">H1</button>
            <button class="editor-icon-btn" [class.active]="isActive('heading', {level:2})" (click)="setHeading(2)" title="Heading 2">H2</button>
            <button class="editor-icon-btn" [class.active]="isActive('heading', {level:3})" (click)="setHeading(3)" title="Heading 3">H3</button>
            <div class="toolbar-divider"></div>
            <button class="editor-icon-btn" [class.active]="isActive('bulletList')" (click)="toggleBulletList()" title="Bullet list">
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16"/></svg>
            </button>
            <button class="editor-icon-btn" [class.active]="isActive('orderedList')" (click)="toggleOrderedList()" title="Ordered list">
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/></svg>
            </button>
            <button class="editor-icon-btn" [class.active]="isActive('taskList')" (click)="toggleTaskList()" title="Task list">
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4"/></svg>
            </button>
            <button class="editor-icon-btn" [class.active]="isActive('blockquote')" (click)="toggleBlockquote()" title="Blockquote">
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 10.5H6a2 2 0 01-2-2v-1a2 2 0 012-2h2m6 0h2a2 2 0 012 2v1a2 2 0 01-2 2h-2m-6 5h6"/></svg>
            </button>
            <div class="toolbar-divider"></div>
            <button class="editor-icon-btn" (click)="imageInput.click()" title="Insert image (or just paste / drop one)">
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"/></svg>
            </button>
            <input #imageInput type="file" accept="image/*" multiple class="sr-only"
                   (change)="onImageInputChange($event); imageInput.value = ''" />
            <div class="toolbar-divider"></div>
            <div class="relative">
              <button
                class="editor-icon-btn"
                [class.active]="isActive('table')"
                (click)="showTableMenu.set(!showTableMenu()); $event.stopPropagation()"
                title="Table"
              >
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                        d="M3 5h18M3 12h18M3 19h18M9 5v14M15 5v14M4 5a1 1 0 00-1 1v12a1 1 0 001 1h16a1 1 0 001-1V6a1 1 0 00-1-1H4z"/>
                </svg>
              </button>
              @if (showTableMenu()) {
                <div class="action-menu action-menu--left" (click)="$event.stopPropagation()">
                  <button class="action-menu-item" (click)="insertTable(); showTableMenu.set(false)">
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 5h16v14H4zM4 10h16M10 5v14"/></svg>
                    Insert table
                  </button>
                  <div class="action-menu-divider"></div>
                  <button class="action-menu-item" [disabled]="!isActive('table')" (click)="addColumnBefore()">
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 5v14M5 9h4M7 7v4"/></svg>
                    Add column left
                  </button>
                  <button class="action-menu-item" [disabled]="!isActive('table')" (click)="addColumnAfter()">
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 5v14M15 9h4M17 7v4"/></svg>
                    Add column right
                  </button>
                  <button class="action-menu-item" [disabled]="!isActive('table')" (click)="addRowBefore()">
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 12h14M9 5h4M7 7h4" transform="rotate(0)"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 7h6M12 5v4"/></svg>
                    Add row above
                  </button>
                  <button class="action-menu-item" [disabled]="!isActive('table')" (click)="addRowAfter()">
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 12h14M9 17h6M12 15v4"/></svg>
                    Add row below
                  </button>
                  <div class="action-menu-divider"></div>
                  <button class="action-menu-item" [disabled]="!isActive('table')" (click)="toggleHeaderRow()">
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 5h16v14H4zM4 9h16"/></svg>
                    Toggle header row
                  </button>
                  <button class="action-menu-item" [disabled]="!isActive('table')" (click)="deleteColumn()">
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 5v14M5 9l4 4M9 9l-4 4"/></svg>
                    Delete column
                  </button>
                  <button class="action-menu-item" [disabled]="!isActive('table')" (click)="deleteRow()">
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 12h14M9 9l4 4M13 9l-4 4"/></svg>
                    Delete row
                  </button>
                  <div class="action-menu-divider"></div>
                  <button class="action-menu-item action-menu-item--danger" [disabled]="!isActive('table')" (click)="deleteTable()">
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-1 12a2 2 0 01-2 2H8a2 2 0 01-2-2L5 7m5 4v6m4-6v6M4 7h16M10 4h4"/></svg>
                    Delete table
                  </button>
                </div>
              }
            </div>
          </div>
          <div class="flex items-center gap-2">
            @if (hasChanges()) {
              <span class="text-xs text-muted">{{ saving() ? 'Saving...' : 'Unsaved changes' }}</span>
            } @else if (lastSaved()) {
              <span class="text-xs text-muted">Saved</span>
            }
            <button class="btn-save" (click)="doneEditing()" [disabled]="saving()" [title]="hasChanges() ? 'Save and view' : 'Done editing'">
              @if (hasChanges()) {
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4"/></svg>
                Save
              } @else {
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/></svg>
                Done
              }
            </button>
          </div>
        } @else if (isReadOnly()) {
          <!-- Read-only banner for git spaces -->
          <div class="flex items-center gap-2">
            <span class="text-sm text-amber-600 font-medium">Read-only — synced from Git</span>
          </div>
        } @else {
          <!-- Read mode for editable documents: spacer keeps the actions group right-aligned -->
          <div></div>
        }
        <div class="flex items-center gap-2" [class.ml-auto]="!showEditor()">
          @if (!showEditor() && canEdit() && !viewingVersion()) {
            <button class="btn-edit" (click)="enterEditMode()" title="Edit document">
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg>
              Edit
            </button>
          }
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
                  @if (!showTranslateMenu()) {
                  <button class="action-menu-item" (click)="showShareDialog.set(true); showActionMenu.set(false)">
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z"></path>
                    </svg>
                    Create a public share
                  </button>
                  <button class="action-menu-item" (click)="openFullscreenPreview(); showActionMenu.set(false)">
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4"/>
                    </svg>
                    Fullscreen preview
                  </button>
                  <button class="action-menu-item" (click)="exportAsPdf(); showActionMenu.set(false)">
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>
                    </svg>
                    Export as PDF
                  </button>
                  <button class="action-menu-item" (click)="downloadFile(); showActionMenu.set(false)">
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/>
                    </svg>
                    Download file
                  </button>
                  @if (canAiEdit()) {
                    <button class="action-menu-item" (click)="openAiEditDialog(); showActionMenu.set(false)">
                      <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z"/>
                      </svg>
                      Edit via AI
                    </button>
                  }
                  @if (getGitUrl()) {
                    <button class="action-menu-item" (click)="copyGitLink(); showActionMenu.set(false)">
                      <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"/>
                      </svg>
                      {{ gitLinkCopied() ? 'Copied!' : 'Get git link' }}
                    </button>
                  }
                  @if (caps.aiEnabled() && !showEditor()) {
                    <button class="action-menu-item" (click)="showTranslateMenu.set(true); $event.stopPropagation()">
                      <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 5h12M9 3v2m1.048 9.5A18.022 18.022 0 016.412 9m6.088 9h7M11 21l5-10 5 10M12.751 5C11.783 10.77 8.07 15.61 3 18.129"/>
                      </svg>
                      Translate
                    </button>
                  }
                  @if (!showEditor()) {
                    <button class="action-menu-item" (click)="openHistory()">
                      <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/>
                      </svg>
                      Version history
                    </button>
                  }
                  <div class="action-menu-divider"></div>
                  <button class="action-menu-item action-menu-item--danger" (click)="confirmDeleteDocument(); showActionMenu.set(false)">
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/>
                    </svg>
                    Delete document
                  </button>
                  } @else {
                    <button class="action-menu-item" (click)="showTranslateMenu.set(false); $event.stopPropagation()">
                      <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7"/>
                      </svg>
                      Translate to…
                    </button>
                    <div class="action-menu-divider"></div>
                    @if (translationLang()) {
                      <button class="action-menu-item" (click)="showOriginal(); $event.stopPropagation()">
                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6"/>
                        </svg>
                        Show original
                      </button>
                    }
                    @for (lang of translateLanguages; track lang.code) {
                      <button class="action-menu-item" [disabled]="translating()" (click)="translateTo(lang.code); $event.stopPropagation()">
                        <span class="action-menu-check">
                          @if (translationLang() === lang.code) {
                            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/>
                            </svg>
                          }
                        </span>
                        {{ lang.label }}
                        @if (translatingLang() === lang.code) {
                          <svg class="w-4 h-4 ml-auto animate-spin" fill="none" viewBox="0 0 24 24">
                            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                          </svg>
                        }
                      </button>
                    }
                  }
                </div>
              }
            </div>
          }
        </div>
      </div>

      }

      @if (isPreviewFile()) {
        <!-- Preview topbar — fixed row, not scrollable -->
        <div class="preview-topbar">
          <div class="preview-filename">
            <span class="material-icons preview-file-icon">{{ previewType() === 'html' ? 'code' : previewType() === 'pdf' ? 'picture_as_pdf' : previewType() === 'drawio' ? 'schema' : previewType() === 'spreadsheet' ? 'grid_on' : 'image' }}</span>
            @if (space()) {
              <a [routerLink]="space()!.fullPath | spaceRoute" class="editor-crumb">{{ space()!.name }}</a>
              @for (seg of fileBreadcrumb(); track seg.path) {
                <span class="editor-crumb-sep">/</span>
                <a
                  [routerLink]="space()!.fullPath | spaceRoute"
                  [queryParams]="{ path: seg.path }"
                  class="editor-crumb"
                >{{ prefs.prettify(seg.label, true) }}</a>
              }
              <span class="editor-crumb-sep">/</span>
            }
            <span class="editor-crumb-active">{{ prefs.prettify(documentPath.split('/').pop() ?? '', false) }}</span>
          </div>
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
                <button class="action-menu-item" (click)="openFullscreenPreview(); showActionMenu.set(false)">
                  <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4"/>
                  </svg>
                  Fullscreen preview
                </button>
                <button class="action-menu-item" (click)="exportAsPdf(); showActionMenu.set(false)">
                  <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>
                  </svg>
                  Export as PDF
                </button>
                <button class="action-menu-item" (click)="downloadFile(); showActionMenu.set(false)">
                  <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/>
                  </svg>
                  Download file
                </button>
                @if (canAiEdit()) {
                  <button class="action-menu-item" (click)="openAiEditDialog(); showActionMenu.set(false)">
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z"/>
                    </svg>
                    Edit via AI
                  </button>
                }
                @if (getGitUrl()) {
                  <button class="action-menu-item" (click)="copyGitLink(); showActionMenu.set(false)">
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"/>
                    </svg>
                    {{ gitLinkCopied() ? 'Copied!' : 'Get git link' }}
                  </button>
                }
                <div class="action-menu-divider"></div>
                <button class="action-menu-item action-menu-item--danger" (click)="confirmDeleteDocument(); showActionMenu.set(false)">
                  <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/>
                  </svg>
                  Delete document
                </button>
              </div>
            }
          </div>
        </div>
        <!-- Scrollable preview content -->
        <div #scrollContainer class="flex-1 overflow-y-auto editor-bg">
          <ng-container *ngTemplateOutlet="aiUndoBanner"></ng-container>
          @if (previewType() === 'html') {
            <div class="html-preview-container annotation-host">
              <iframe [src]="safePreviewUrl()" class="preview-iframe" sandbox="allow-scripts allow-same-origin"></iframe>
              @if (space() && documentPath) {
                <app-annotation-overlay
                  [spaceId]="space()!.id"
                  [filePath]="documentPath"
                  [renderMode]="'html'"
                  [permission]="annotationPermission()"
                />
              }
            </div>
          } @else if (previewType() === 'pdf') {
            <div class="pdf-preview-container annotation-host">
              <iframe [src]="safePreviewUrl()" class="preview-iframe"></iframe>
              @if (space() && documentPath) {
                <app-annotation-overlay
                  [spaceId]="space()!.id"
                  [filePath]="documentPath"
                  [renderMode]="'pdf'"
                  [permission]="annotationPermission()"
                />
              }
            </div>
          } @else if (previewType() === 'drawio') {
            <div class="drawio-preview-container">
              <div #drawioElement class="drawio" [attr.data-drawio-src]="previewUrl()"></div>
            </div>
          } @else if (previewType() === 'spreadsheet') {
            <div class="spreadsheet-preview-container">
              @if (loading()) {
                <div class="flex items-center justify-center py-12">
                  <svg class="animate-spin h-8 w-8 text-primary-600" fill="none" viewBox="0 0 24 24">
                    <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                    <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                  </svg>
                </div>
              } @else if (spreadsheetError()) {
                <p class="spreadsheet-error">{{ spreadsheetError() }}</p>
              } @else {
                <div class="markdown-readonly" [innerHTML]="spreadsheetHtml()"></div>
              }
            </div>
          } @else {
            <div class="image-zoom-container annotation-host" [class.dragging]="isDraggingImage()" (mousedown)="onImageDragStart($event)">
              <img
                [src]="previewUrl()"
                [alt]="documentPath.split('/').pop()"
                class="preview-image"
                [style.width]="imageZoom() === 1 ? null : (imageZoom() * 100) + '%'"
              />
              @if (space() && documentPath) {
                <app-annotation-overlay
                  [spaceId]="space()!.id"
                  [filePath]="documentPath"
                  [renderMode]="'image'"
                  [permission]="annotationPermission()"
                />
              }
            </div>
            <div class="zoom-toolbar">
              <button class="zoom-btn" (click)="zoomOut()" [disabled]="imageZoom() <= 0.25" title="Zoom out">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20 12H4"/>
                </svg>
              </button>
              <button class="zoom-level" (click)="resetZoom()" title="Reset to 100%">
                {{ (imageZoom() * 100).toFixed(0) }}%
              </button>
              <button class="zoom-btn" (click)="zoomIn()" [disabled]="imageZoom() >= 4" title="Zoom in">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"/>
                </svg>
              </button>
            </div>
          }
        </div>
      } @else {
        <!-- Editor Area -->
        <div #scrollContainer class="flex-1 overflow-y-auto editor-bg">
          <div class="mx-auto px-8 py-6 paper" [class.paper-full]="isDataView()" [style.maxWidth.px]="isDataView() ? null : contentWidthPx()">
            @if (loading()) {
              <div class="flex items-center justify-center py-12">
                <svg class="animate-spin h-8 w-8 text-primary-600" fill="none" viewBox="0 0 24 24">
                  <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                  <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                </svg>
              </div>
            } @else {
              <input
                type="text"
                [(ngModel)]="documentTitle"
                placeholder="Untitled"
                [readonly]="!showEditor()"
                class="editor-title"
              />

              <ng-container *ngTemplateOutlet="aiUndoBanner"></ng-container>

              @if (!showEditor()) {
                <!-- Read mode: full markdown pipeline incl. Mermaid + image lightbox -->
                @if (viewingVersion(); as version) {
                  <div class="timecapsule-banner">
                    <svg class="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/>
                    </svg>
                    <span>
                      Time capsule —
                      {{ historyViewMode() === 'diff' ? 'changes in the version from' : 'viewing the version from' }}
                      <strong>{{ version.committedAt | date:'MMM d, y, HH:mm' }}</strong>
                      @if (version.authorName) { by {{ version.authorName }} }
                    </span>
                    <div class="timecapsule-actions">
                      @if (!isCurrentVersion(version)) {
                        <button type="button" class="timecapsule-back" (click)="historyViewMode() === 'diff' ? viewVersion(version) : viewDiff(version)">
                          {{ historyViewMode() === 'diff' ? 'Show document' : 'Show changes' }}
                        </button>
                      }
                      @if (canEdit() && !isCurrentVersion(version)) {
                        <button type="button" class="timecapsule-restore" [disabled]="restoring()" (click)="restoreVersion(version)">
                          @if (restoring()) {
                            <svg class="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                              <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                              <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                            </svg>
                          }
                          Restore this version
                        </button>
                      }
                      <button type="button" class="timecapsule-back" (click)="backToCurrent()">Back to current</button>
                    </div>
                  </div>
                }
                @if (caps.aiEnabled() && availableLangs().length > 0) {
                  <div class="translation-banner">
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 5h12M9 3v2m1.048 9.5A18.022 18.022 0 016.412 9m6.088 9h7M11 21l5-10 5 10M12.751 5C11.783 10.77 8.07 15.61 3 18.129"/>
                    </svg>
                    <span>
                      @if (translationLang()) {
                        Translated to {{ languageLabel(translationLang()!) }} · AI-generated, may contain errors
                      } @else {
                        Available in
                      }
                    </span>
                    <div class="translation-chips">
                      @for (code of availableLangs(); track code) {
                        <span class="translation-chip" [class.active]="translationLang() === code">
                          <button
                            type="button"
                            class="translation-chip-label"
                            [disabled]="translatingLang() === code"
                            (click)="translateTo(code)"
                          >
                            {{ languageLabel(code) }}
                            @if (translatingLang() === code) {
                              <svg class="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                                <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                              </svg>
                            }
                          </button>
                          <button
                            type="button"
                            class="translation-chip-remove"
                            [title]="'Remove ' + languageLabel(code) + ' translation'"
                            (click)="removeTranslation(code)"
                          >
                            <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/>
                            </svg>
                          </button>
                        </span>
                      }
                    </div>
                    @if (translationLang()) {
                      <button type="button" class="translation-original" (click)="showOriginal()">Show original</button>
                    }
                  </div>
                }
                @if (viewingVersion() && historyViewMode() === 'diff') {
                  <div class="diff-view">
                    @for (line of diffLines(); track $index) {
                      <div
                        class="diff-line"
                        [class.diff-add]="line.type === 'add'"
                        [class.diff-del]="line.type === 'del'"
                        [class.diff-hunk]="line.type === 'hunk'"
                      >@if (line.type !== 'hunk') {<span class="diff-sign">{{ line.type === 'add' ? '+' : line.type === 'del' ? '−' : ' ' }}</span>}{{ line.text }}</div>
                    } @empty {
                      <p class="diff-empty">This version did not change this document.</p>
                    }
                  </div>
                } @else {
                  <article
                    #readonlyElement
                    class="markdown-readonly"
                    [innerHTML]="readonlyHtml()"
                    (click)="onMarkdownClick($event)"
                  ></article>
                }
              } @else {
                <!-- TipTap Editor Container -->
                <div
                  #editorElement
                  class="prose prose-lg max-w-none"
                ></div>
              }
            }
            @if (space() && documentPath) {
              <app-annotation-overlay
                [spaceId]="space()!.id"
                [filePath]="documentPath"
                [renderMode]="'markdown'"
                [permission]="annotationPermission()"
              />
            }
            @if (!isDataView()) {
              <div class="paper-resize-handle"
                   title="Drag to resize content width"
                   (mousedown)="onWidthResizeStart($event)"
                   [class.dragging]="isResizingWidth()"></div>
            }
          </div>
        </div>
      }


      <ng-template #aiUndoBanner>
        <app-ai-edit-step-back
          [spaceId]="space()?.id || ''"
          [undo]="aiEditUndo()"
          [viewingPrevious]="viewingAiPrevious()"
          [canPreview]="!isPreviewFile()"
          (showPrevious)="onAiPreviewPrevious($event)"
          (showCurrent)="onAiPreviewCurrent()"
          (dismissed)="aiEditUndo.set(null)"
          (reverted)="onAiReverted()"
        />
      </ng-template>

      @if (showAiEditDialog() && space() && documentPath) {
        <app-ai-edit-dialog
          [spaceId]="space()!.id"
          [filePath]="documentPath"
          (closed)="showAiEditDialog.set(false)"
          (applied)="onAiEditApplied($event)"
        />
      }

      @if (showShareDialog() && space() && documentPath) {
        <app-share-link-dialog
          [spaceId]="space()!.id"
          [filePath]="documentPath"
          (close)="showShareDialog.set(false)"
        />
      }

      <!-- Floating AI chat entry — same bubble as the dashboard, scoped to this document -->
      @if (caps.aiChat() && space() && documentPath && !showAiEditDialog()) {
        <button class="ai-fab" title="Chat with AI about this document" (click)="openAiChat()">
          <span class="material-icons">auto_awesome</span>
        </button>
      }

      @if (showDeleteConfirm()) {
        <div class="modal-overlay" (click)="showDeleteConfirm.set(false)">
          <div class="delete-modal" (click)="$event.stopPropagation()">
            <div class="delete-modal-header">
              <h2>Delete document</h2>
              <button class="editor-icon-btn" (click)="showDeleteConfirm.set(false)">
                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/>
                </svg>
              </button>
            </div>
            <div class="delete-modal-body">
              <p>Are you sure you want to delete <strong>{{ documentPath.split('/').pop() }}</strong>?</p>
              <p class="delete-modal-hint">This action cannot be undone.</p>
            </div>
            <div class="delete-modal-footer">
              <button type="button" (click)="showDeleteConfirm.set(false)" class="btn-secondary">Cancel</button>
              <button type="button" (click)="deleteDocument()" [disabled]="deleting()" class="btn-danger">
                @if (deleting()) {
                  <svg class="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                    <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                  </svg>
                  Deleting...
                } @else {
                  Delete
                }
              </button>
            </div>
          </div>
        </div>
      }

      @if (showExportStateDialog()) {
        <app-export-state-dialog
          [fileName]="documentPath.split('/').pop() || 'document'"
          (chosen)="onExportStateChosen($event)"
          (closed)="showExportStateDialog.set(false)"
        />
      }

      @if (showHistoryPanel()) {
        <aside class="history-panel" (click)="$event.stopPropagation()">
          <div class="history-header">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/>
            </svg>
            <span>Version history</span>
            <button class="editor-icon-btn ml-auto" title="Close" (click)="closeHistory()">
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/>
              </svg>
            </button>
          </div>
          @if (historyLoading()) {
            <div class="history-loading">
              <svg class="animate-spin h-6 w-6" fill="none" viewBox="0 0 24 24">
                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
              </svg>
            </div>
          } @else if (historyVersions().length === 0) {
            <p class="history-empty">
              No versions recorded yet. Every save from now on becomes a version you can
              come back to here.
            </p>
          } @else {
            <div class="history-list">
              @for (v of historyVersions(); track v.sha; let i = $index) {
                <div class="history-item-wrap">
                  <button
                    type="button"
                    class="history-item"
                    [class.active]="viewingVersion()?.sha === v.sha || (i === 0 && !viewingVersion())"
                    (click)="viewVersion(v)"
                  >
                    <div class="history-item-top">
                      <span class="history-item-date">{{ v.committedAt | date:'MMM d, y, HH:mm' }}</span>
                      @if (i === 0) {
                        <span class="history-badge-current">Current</span>
                      }
                      @if (versionLoadingSha() === v.sha) {
                        <svg class="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                          <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                          <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                        </svg>
                      }
                    </div>
                    @if (v.message) {
                      <div class="history-item-msg">{{ v.message }}</div>
                    }
                    @if (v.authorName) {
                      <div class="history-item-author">{{ v.authorName }}</div>
                    }
                  </button>
                  <button
                    type="button"
                    class="history-item-diff"
                    title="Show changes in this version"
                    [class.active]="viewingVersion()?.sha === v.sha && historyViewMode() === 'diff'"
                    (click)="viewDiff(v); $event.stopPropagation()"
                  >
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5v14m-3-3h6M15 8h6"/>
                    </svg>
                  </button>
                </div>
              }
            </div>
          }
        </aside>
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

    .editor-breadcrumb-row {
      display: flex;
      align-items: center;
      gap: 6px;
      flex-wrap: wrap;
      background: var(--surface);
      border-bottom: 1px solid var(--border);
      padding: 8px 16px;
      font-size: 12px;
      color: var(--text-muted);
    }

    .editor-icon-btn {
      padding: 6px 8px;
      border-radius: 6px;
      border: none;
      background: none;
      color: var(--text-secondary);
      cursor: pointer;
      display: flex;
      align-items: center;
      font-size: 0.8125rem;
      font-weight: 600;
      line-height: 1;

      &:hover { background: var(--background); }
      &.active { background: var(--background); color: var(--primary); }
    }

    .toolbar-divider {
      width: 1px;
      height: 20px;
      background: var(--border);
      margin: 0 4px;
    }

    .btn-save {
      display: flex;
      align-items: center;
      gap: 4px;
      padding: 6px 12px;
      border-radius: 6px;
      border: none;
      background: var(--primary);
      color: white;
      font-size: 0.8125rem;
      font-weight: 500;
      cursor: pointer;
      transition: background 0.15s;

      &:hover:not(:disabled) { background: var(--primary-dark, #2563eb); }
      &:disabled { opacity: 0.5; cursor: not-allowed; }
    }

    .btn-edit {
      display: flex;
      align-items: center;
      gap: 4px;
      padding: 6px 12px;
      border-radius: 6px;
      border: 1px solid var(--border);
      background: var(--surface);
      color: var(--text-primary);
      font-size: 0.8125rem;
      font-weight: 500;
      cursor: pointer;
      transition: background 0.15s, border-color 0.15s;

      &:hover { background: var(--background); border-color: var(--primary); color: var(--primary); }
    }

    .text-muted { color: var(--text-muted); }

    .editor-title {
      width: 100%;
      font-size: 1.875rem;
      font-weight: 700;
      color: var(--text-primary);
      border: none;
      outline: none;
      margin-bottom: 24px;
      background: transparent;

      &[readonly] { cursor: default; }
    }

    .paper {
      background: var(--surface);
      min-height: calc(100vh - 120px);
      margin-top: 24px;
      margin-bottom: 24px;
      border-radius: 4px;
      box-shadow: var(--shadow-sm);
      position: relative;
    }

    .paper-resize-handle {
      position: absolute;
      top: 0;
      right: -6px;
      width: 12px;
      height: 100%;
      cursor: col-resize;
      z-index: 10;

      &::after {
        content: '';
        position: absolute;
        top: 50%;
        right: 5px;
        transform: translateY(-50%);
        width: 2px;
        height: 48px;
        border-radius: 2px;
        background: var(--border, #d4e5e7);
        opacity: 0;
        transition: opacity 0.15s, background 0.15s;
      }

      &:hover::after,
      &.dragging::after {
        opacity: 1;
        background: var(--primary, #6fb3b8);
      }
    }

    .preview-topbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0 16px;
      height: 44px;
      flex-shrink: 0;
      background: var(--surface);
      border-bottom: 1px solid var(--border);
    }

    .preview-filename {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 0.875rem;
      color: var(--text-secondary);
      font-weight: 500;
    }

    .preview-file-icon {
      font-size: 16px;
      color: var(--text-muted);
    }

    .editor-crumb {
      color: var(--text-secondary);
      text-decoration: none;
      padding: 2px 4px;
      border-radius: 4px;

      &:hover {
        background: var(--background);
        color: var(--text-primary);
      }
    }

    .editor-crumb-active {
      color: var(--text-primary);
      font-weight: 600;
    }

    .editor-crumb-sep {
      color: var(--text-muted);
      user-select: none;
    }

    .annotation-host { position: relative; }

    .html-preview-container,
    .pdf-preview-container {
      flex: 1;
      display: flex;
      min-height: 100%;
    }

    // Spreadsheet (xlsx/xls) preview: full-width, no paper column, so wide
    // sheets use the available space instead of being squeezed + side-scrolled.
    .spreadsheet-preview-container {
      flex: 1;
      min-height: 100%;
      padding: 24px 32px;
      background: var(--surface);
    }

    .spreadsheet-error {
      color: var(--text-muted);
      text-align: center;
      padding: 48px 0;
    }

    // Data views (JSON/CSV/TSV/TAB/SQL) drop the paper max-width entirely.
    .paper.paper-full {
      max-width: none;
      width: 100%;
    }

    .image-zoom-container {
      overflow: auto;
      // Reserve the scrollbar gutter permanently so a vertical scrollbar
      // toggling on/off never changes the content-box width. Without this,
      // the width:100% image + width transition oscillate (scrollbar appears →
      // width shrinks → image shorter → scrollbar hides → width grows → …),
      // producing a visible jitter while previewing.
      scrollbar-gutter: stable;
      flex: 1;
      width: 100%;
      min-height: 0;
      display: flex;
      align-items: center;
      cursor: grab;
      user-select: none;

      &.dragging { cursor: grabbing; }
    }

    .preview-image {
      width: 100%;
      max-width: none;
      height: auto;
      display: block;
      margin: 0 auto;
      transition: width 0.15s ease;
    }

    .zoom-toolbar {
      position: fixed;
      bottom: 20px;
      left: calc(var(--sidebar-width, 280px) + 20px);
      display: flex;
      align-items: center;
      gap: 0.25rem;
      padding: 6px 8px;
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 10px;
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.12);
      z-index: 200;
    }

    .zoom-btn {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 28px;
      height: 28px;
      border-radius: 4px;
      border: none;
      background: none;
      color: var(--text-primary);
      cursor: pointer;
      transition: background 0.15s;

      &:hover:not(:disabled) { background: var(--surface-hover); }
      &:disabled { opacity: 0.4; cursor: not-allowed; }
    }

    .zoom-level {
      min-width: 48px;
      height: 28px;
      border-radius: 4px;
      border: none;
      background: none;
      color: var(--text-primary);
      font-size: 0.75rem;
      font-weight: 500;
      cursor: pointer;
      transition: background 0.15s;

      &:hover { background: var(--surface-hover); }
    }

    .preview-iframe {
      width: 100%;
      height: 100%;
      min-height: calc(100vh - 104px);
      border: none;
      background: var(--surface);
      display: block;
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

    .action-menu--left {
      right: auto;
      left: 0;
    }

    .action-menu-item:disabled {
      opacity: 0.4;
      cursor: default;
    }

    .action-menu-item:disabled:hover {
      background: none;
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

    .action-menu-item--danger {
      color: var(--error, #dc2626);
    }

    .action-menu-item--danger:hover {
      background: rgba(220, 38, 38, 0.08);
    }

    .action-menu-divider {
      height: 1px;
      background: var(--border);
      margin: 4px 0;
    }

    .action-menu-check {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 16px;
      flex-shrink: 0;
      color: var(--primary);
    }

    .highlight-menu {
      min-width: 0;
      padding: 8px;
    }

    .highlight-swatches {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 6px;
    }

    .highlight-swatch {
      width: 26px;
      height: 26px;
      padding: 0;
      border-radius: 6px;
      border: 1px solid var(--border);
      cursor: pointer;
      transition: transform 0.1s;

      &:hover { transform: scale(1.12); }
      &.active { box-shadow: 0 0 0 2px var(--surface), 0 0 0 4px var(--primary); }
    }

    .translation-banner {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 8px;
      margin-bottom: 16px;
      padding: 8px 12px;
      border-radius: 8px;
      background: var(--background);
      border: 1px solid var(--border);
      font-size: 0.8125rem;
      color: var(--text-secondary);
    }

    .translation-banner > svg {
      color: var(--primary);
      flex-shrink: 0;
    }

    .translation-banner > span {
      flex-shrink: 0;
    }

    .translation-chips {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
    }

    .translation-chip {
      display: inline-flex;
      align-items: center;
      border: 1px solid var(--border);
      background: var(--surface);
      border-radius: 999px;
      overflow: hidden;
      white-space: nowrap;
    }

    .translation-chip:hover {
      border-color: var(--primary);
    }

    .translation-chip.active {
      background: var(--primary);
      border-color: var(--primary);
    }

    .translation-chip-label {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      border: none;
      background: none;
      color: var(--text-primary);
      font-size: 0.75rem;
      font-weight: 500;
      cursor: pointer;
      padding: 3px 4px 3px 10px;
      white-space: nowrap;
    }

    .translation-chip.active .translation-chip-label {
      color: #fff;
    }

    .translation-chip-label:disabled {
      cursor: default;
      opacity: 0.7;
    }

    .translation-chip-remove {
      display: inline-flex;
      align-items: center;
      border: none;
      background: none;
      color: var(--text-muted);
      cursor: pointer;
      padding: 3px 8px 3px 3px;
    }

    .translation-chip-remove:hover {
      color: var(--error, #dc2626);
    }

    .translation-chip.active .translation-chip-remove {
      color: rgba(255, 255, 255, 0.75);
    }

    .translation-chip.active .translation-chip-remove:hover {
      color: #fff;
    }

    .translation-original {
      margin-left: auto;
      border: none;
      background: none;
      color: var(--primary);
      font-size: 0.8125rem;
      font-weight: 600;
      cursor: pointer;
      padding: 2px 4px;
      border-radius: 4px;
      white-space: nowrap;
    }

    .translation-original:hover {
      text-decoration: underline;
    }

    .modal-overlay {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.5);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 1000;
      padding: 1.5rem;
    }

    .delete-modal {
      background: var(--surface);
      border-radius: 12px;
      width: 100%;
      max-width: 400px;
      box-shadow: var(--shadow-lg);
    }

    .delete-modal-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 1.25rem 1.5rem;
      border-bottom: 1px solid var(--border);

      h2 {
        font-size: 1.125rem;
        font-weight: 600;
        color: var(--text-primary);
      }
    }

    .delete-modal-body {
      padding: 1.25rem 1.5rem;

      p {
        color: var(--text-primary);
        font-size: 0.9375rem;
        line-height: 1.5;
      }
    }

    .delete-modal-hint {
      color: var(--text-muted) !important;
      font-size: 0.8125rem !important;
      margin-top: 0.5rem;
    }

    .delete-modal-footer {
      display: flex;
      justify-content: flex-end;
      gap: 0.75rem;
      padding: 1rem 1.5rem;
      border-top: 1px solid var(--border);
    }

    .btn-secondary {
      padding: 8px 16px;
      border-radius: 8px;
      border: 1px solid var(--border);
      background: var(--surface);
      color: var(--text-primary);
      font-size: 0.875rem;
      font-weight: 500;
      cursor: pointer;

      &:hover {
        background: var(--background);
      }
    }

    .btn-danger {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 8px 16px;
      border-radius: 8px;
      border: none;
      background: #dc2626;
      color: white;
      font-size: 0.875rem;
      font-weight: 500;
      cursor: pointer;

      &:hover:not(:disabled) {
        background: #b91c1c;
      }

      &:disabled {
        opacity: 0.6;
        cursor: not-allowed;
      }
    }

    .timecapsule-banner {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 8px;
      padding: 10px 14px;
      margin-bottom: 16px;
      border-radius: 8px;
      border: 1px solid var(--primary);
      background: color-mix(in srgb, var(--primary) 8%, var(--surface));
      color: var(--text-primary);
      font-size: 0.8125rem;

      .timecapsule-actions {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-left: auto;
      }

      .timecapsule-restore {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 5px 12px;
        border-radius: 6px;
        border: none;
        background: var(--primary);
        color: white;
        font-size: 0.8125rem;
        font-weight: 500;
        cursor: pointer;

        &:hover:not(:disabled) {
          background: var(--primary-dark);
        }

        &:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }
      }

      .timecapsule-back {
        padding: 5px 12px;
        border-radius: 6px;
        border: 1px solid var(--border);
        background: var(--surface);
        color: var(--text-primary);
        font-size: 0.8125rem;
        cursor: pointer;

        &:hover {
          background: var(--surface-hover);
        }
      }
    }

    .history-panel {
      /* Anchored to the editor host (position: relative), not the viewport —
         a fixed top:0 panel would hide its header under the app header bar. */
      position: absolute;
      top: 0;
      right: 0;
      bottom: 0;
      width: 320px;
      display: flex;
      flex-direction: column;
      background: var(--surface);
      border-left: 1px solid var(--border);
      box-shadow: var(--shadow-lg);
      z-index: 60;
    }

    .history-header {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 14px 16px;
      border-bottom: 1px solid var(--border);
      font-weight: 600;
      font-size: 0.875rem;
      color: var(--text-primary);
    }

    .history-loading {
      display: flex;
      justify-content: center;
      padding: 32px 0;
      color: var(--text-muted);
    }

    .history-empty {
      padding: 20px 16px;
      font-size: 0.8125rem;
      color: var(--text-muted);
    }

    .history-list {
      flex: 1;
      overflow-y: auto;
      padding: 8px;
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .history-item-wrap {
      position: relative;

      &:hover .history-item-diff,
      .history-item-diff.active {
        opacity: 1;
      }
    }

    .history-item {
      display: block;
      width: 100%;
      text-align: left;
      padding: 10px 12px;
      border-radius: 8px;
      border: 1px solid transparent;
      background: transparent;
      cursor: pointer;

      &:hover {
        background: var(--surface-hover);
      }

      &.active {
        border-color: var(--primary);
        background: color-mix(in srgb, var(--primary) 8%, var(--surface));
      }
    }

    .history-item-diff {
      position: absolute;
      top: 8px;
      right: 8px;
      display: flex;
      align-items: center;
      justify-content: center;
      width: 26px;
      height: 26px;
      border-radius: 6px;
      border: 1px solid var(--border);
      background: var(--surface);
      color: var(--text-secondary);
      cursor: pointer;
      opacity: 0;
      transition: opacity var(--transition);

      &:hover {
        background: var(--surface-hover);
        color: var(--text-primary);
      }

      &.active {
        border-color: var(--primary);
        color: var(--primary);
      }
    }

    .diff-view {
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 0.8125rem;
      line-height: 1.5;
      border: 1px solid var(--border);
      border-radius: 8px;
      overflow-x: auto;
      background: var(--surface);
    }

    .diff-line {
      display: flex;
      padding: 0 10px;
      white-space: pre-wrap;
      word-break: break-word;
      color: var(--text-primary);

      &.diff-add {
        background: color-mix(in srgb, #16a34a 14%, var(--surface));
      }

      &.diff-del {
        background: color-mix(in srgb, #dc2626 12%, var(--surface));
      }

      &.diff-hunk {
        padding: 3px 10px;
        background: var(--background);
        color: var(--text-muted);
        font-size: 0.75rem;
      }
    }

    .diff-sign {
      flex-shrink: 0;
      width: 16px;
      user-select: none;
      color: var(--text-muted);
    }

    .diff-empty {
      padding: 16px;
      color: var(--text-muted);
      font-size: 0.8125rem;
    }

    .history-item-top {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .history-item-date {
      font-size: 0.8125rem;
      font-weight: 600;
      color: var(--text-primary);
    }

    .history-badge-current {
      padding: 1px 8px;
      border-radius: 999px;
      background: var(--primary);
      color: white;
      font-size: 0.6875rem;
      font-weight: 600;
    }

    .history-item-msg {
      margin-top: 2px;
      font-size: 0.75rem;
      color: var(--text-secondary);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .history-item-author {
      margin-top: 2px;
      font-size: 0.75rem;
      color: var(--text-muted);
    }

    .ai-fab {
      position: fixed;
      bottom: var(--spacing-xl);
      right: var(--spacing-xl);
      width: 56px;
      height: 56px;
      border-radius: 50%;
      background: linear-gradient(135deg, var(--primary) 0%, var(--primary-dark) 100%);
      border: none;
      color: white;
      cursor: pointer;
      box-shadow: var(--shadow-lg);
      display: flex;
      align-items: center;
      justify-content: center;
      transition: all var(--transition);
      z-index: 50;

      .material-icons {
        font-size: 24px;
      }

      &:hover {
        transform: scale(1.1);
        box-shadow: var(--shadow-xl);
      }
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
  // Turndown core has no rule for <table>, so it would otherwise flatten a
  // table into its concatenated cell text. The GFM tables rule serialises it
  // to a pipe-delimited Markdown table that marked parses back on load.
  }).use(turndownTables)
    // TipTap wraps every cell's content in <p>. Turndown's default paragraph
    // rule pads that with blank lines, which shatters the single-line GFM cell.
    // Override paragraphs *inside* table cells to emit inline content only
    // (multiple paragraphs in one cell collapse to a <br>, the only line break
    // GFM cells allow). Added after .use() so it wins — Turndown unshifts rules,
    // so the most recently registered match takes precedence.
    .addRule('tableCellParagraph', {
      filter: (node) =>
        node.nodeName === 'P' &&
        !!node.parentNode &&
        (node.parentNode.nodeName === 'TD' || node.parentNode.nodeName === 'TH'),
      replacement: (content, node) => {
        const inline = content.replace(/\n+/g, ' ').trim();
        return (node as HTMLElement).previousElementSibling ? '<br>' + inline : inline;
      },
    })
    // Highlights have no Markdown equivalent, so keep them as inline HTML (which
    // marked passes through verbatim on load). The colour is carried both as
    // data-color (parsed back into the mark's attribute) and an inline
    // background-color (so it renders in read mode and any external Markdown
    // viewer). Colourless highlights degrade to a bare <mark>.
    .addRule('highlight', {
      filter: 'mark',
      replacement: (content, node) => {
        if (!content.trim()) return content;
        const el = node as HTMLElement;
        const color = el.getAttribute('data-color') || el.style.backgroundColor;
        if (!color) return `<mark>${content}</mark>`;
        return `<mark data-color="${color}" style="background-color:${color}">${content}</mark>`;
      },
    });
  private autoSave$ = new Subject<void>();
  @ViewChild('editorElement') editorElement!: ElementRef<HTMLElement>;
  @ViewChild('scrollContainer') scrollContainer?: ElementRef<HTMLElement>;

  private static readonly IMAGE_EXTENSIONS = new Set([
    'jpg', 'jpeg', 'png', 'gif', 'svg', 'webp', 'bmp', 'ico', 'avif'
  ]);
  private static readonly HTML_EXTENSIONS = new Set(['html', 'htm']);
  private static readonly PDF_EXTENSIONS = new Set(['pdf']);
  // Binary spreadsheets — fetched as bytes and parsed client-side into tables.
  private static readonly SPREADSHEET_EXTENSIONS = new Set(['xlsx', 'xls']);

  space = signal<Space | null>(null);
  document = signal<DocumentContent | null>(null);
  documentTitle = '';
  documentPath = '';
  // Folder a new document is being created in (from the ?folder= query param).
  newDocFolder = '';
  /** Tracks documentPath as a signal so computed breadcrumbs react to changes. */
  documentPathSignal = signal<string>('');

  /** Ancestor folders of the current document, clickable to jump back into the
   *  overview folder browser. */
  fileBreadcrumb = computed<{ label: string; path: string }[]>(() => {
    const p = this.documentPathSignal();
    if (!p || !p.includes('/')) return [];
    const parts = p.split('/');
    return parts.slice(0, -1).map((label, i) => ({
      label,
      path: parts.slice(0, i + 1).join('/'),
    }));
  });
  loading = signal(true);
  saving = signal(false);
  lastSaved = signal(false);
  hasChanges = signal(false);
  showAiMenu = signal(false);
  showChat = signal(false);
  showShareDialog = signal(false);
  showActionMenu = signal(false);
  showTranslateMenu = signal(false);
  showTableMenu = signal(false);
  showHighlightMenu = signal(false);

  // Highlight palette. Light -200-ish shades that keep dark text legible in both
  // themes; the hex is stored verbatim in the Markdown so it round-trips.
  readonly highlightColors: { name: string; value: string }[] = [
    { name: 'Yellow', value: '#fef08a' },
    { name: 'Green', value: '#bbf7d0' },
    { name: 'Blue', value: '#bfdbfe' },
    { name: 'Pink', value: '#fbcfe8' },
    { name: 'Orange', value: '#fed7aa' },
    { name: 'Purple', value: '#e9d5ff' },
    { name: 'Red', value: '#fecaca' },
    { name: 'Gray', value: '#e5e7eb' }
  ];

  // AI translation: offered set must mirror TranslationService.supportedLanguages on the backend.
  readonly translateLanguages = [
    { code: 'en', label: 'English' },
    { code: 'de', label: 'Deutsch' },
    { code: 'fr', label: 'Français' },
    { code: 'es', label: 'Español' },
    { code: 'it', label: 'Italiano' }
  ];
  // Active translation language code, or null when the original is shown.
  translationLang = signal<string | null>(null);
  // Language code currently being fetched, or null when idle.
  translatingLang = signal<string | null>(null);
  translating = computed(() => this.translatingLang() !== null);
  // Languages this document already has a cached translation for — drives the read-mode bar.
  availableLangs = signal<string[]>([]);
  // A translation language requested via the ?lang= query param, applied once the document has loaded.
  private pendingLang: string | null = null;
  showDeleteConfirm = signal(false);
  showExportStateDialog = signal(false);
  deleting = signal(false);
  // "Edit via AI": the AI applies a free-form instruction to the whole file and
  // saves the result as a commit; aiEditUndo powers the step-back banner.
  showAiEditDialog = signal(false);
  aiEditUndo = signal<AiEditUndoState | null>(null);
  // Read-only preview of the pre-AI-edit version (nothing is written until the
  // revert is confirmed inside the step-back component).
  viewingAiPrevious = signal(false);
  canAiEdit = computed(() =>
    this.caps.aiEnabled() &&
    !this.isNewDocument() &&
    !!this.documentPathSignal() &&
    isAiEditable(this.documentPathSignal())
  );
  // Version history ("time capsule"): drawer with every commit that touched the
  // document; selecting one renders it read-only, restore writes it as a new version.
  showHistoryPanel = signal(false);
  historyVersions = signal<DocumentVersion[]>([]);
  historyLoading = signal(false);
  versionLoadingSha = signal<string | null>(null);
  viewingVersion = signal<DocumentVersion | null>(null);
  // 'doc' renders the version's content, 'diff' what its commit changed.
  historyViewMode = signal<'doc' | 'diff'>('doc');
  diffLines = signal<DiffLine[]>([]);
  restoring = signal(false);
  isCurrentVersion = (version: DocumentVersion) => version.sha === this.historyVersions()[0]?.sha;
  gitLinkCopied = signal(false);
  isPreviewFile = signal(false);
  previewType = signal<'image' | 'html' | 'pdf' | 'drawio' | 'spreadsheet'>('image');
  previewUrl = signal('');
  // Parsed-and-rendered HTML for a spreadsheet (xlsx/xls) preview.
  spreadsheetHtml = signal<SafeHtml>('');
  spreadsheetError = signal<string | null>(null);
  safePreviewUrl = signal<SafeResourceUrl>('');
  imageZoom = signal(1);
  isDraggingImage = signal(false);
  isGitSpace = computed(() => !!this.space()?.gitlabUrl);
  // A freshly-created document that has never been saved is editable even in a
  // git-backed space.
  isNewDocument = signal(false);
  private isMarkdownDoc = computed(() => {
    const ext = this.documentPathSignal().split('.').pop()?.toLowerCase() || '';
    return ext === 'md' || ext === 'markdown';
  });
  // Markdown files are editable everywhere: saves go through a minimal-diff
  // merge (mergeMarkdownEdits) so untouched blocks keep their original
  // formatting and git diffs stay small. Other file types in git-backed
  // spaces stay read-only — round-tripping them through TipTap would mangle them.
  isReadOnly = computed(() => this.isGitSpace() && !this.isNewDocument() && !this.isMarkdownDoc());
  annotationPermission = signal<AnnotationPermission>('VIEW');

  // Read/edit split: documents open in rendered read mode; the user clicks Edit
  // to switch to the TipTap editor.
  editMode = signal(false);
  canEdit = computed(() => !this.isReadOnly());
  // True only when the TipTap editor + toolbar should be shown.
  showEditor = computed(() => this.canEdit() && this.editMode());
  // A structured-data view (JSON/CSV/TSV/TAB/SQL in read mode, or an xlsx/xls
  // spreadsheet preview). These render full-width without a paper column so
  // wide tables and long lines don't force side-scrolling.
  isDataView = computed(() => {
    if (this.isPreviewFile()) return this.previewType() === 'spreadsheet';
    const ext = this.documentPathSignal().split('.').pop()?.toLowerCase() || '';
    return this.dataFileService.isDataFile(ext);
  });
  // Raw (title-stripped) markdown for the current document — feeds both the
  // read-mode render and the TipTap editor when entering edit mode.
  private markdownContent = signal('');
  // Leading "# Title" line (incl. trailing newlines) stripped on load; saves
  // re-prepend it because the backend persists content verbatim.
  private strippedH1: string | null = null;
  // Minimal-diff save support: the markdown as loaded and the serializer's
  // output for the untouched editor. mergeMarkdownEdits() diffs against these
  // so unedited blocks keep their original formatting byte-for-byte.
  private editSessionOriginal: string | null = null;
  private editSessionBaseline: string | null = null;

  // Read render (markdown pipeline). Bypasses TipTap so Mermaid blocks render as SVG.
  readonlyHtml = signal<SafeHtml>('');
  @ViewChild('readonlyElement') readonlyElement?: ElementRef<HTMLElement>;
  @ViewChild('drawioElement') drawioElement?: ElementRef<HTMLElement>;

  // Drag-resizable content width — persisted on the backend per (space, file) so the whole team sees it.
  private static readonly CONTENT_WIDTH_DEFAULT = 896; // matches Tailwind max-w-4xl
  contentWidthPx = signal<number>(EditorComponent.CONTENT_WIDTH_DEFAULT);
  isResizingWidth = signal(false);
  private widthDragStart: { startX: number; startWidth: number } | null = null;
  private boundWidthMove = this.onWidthResizeMove.bind(this);
  private boundWidthEnd = this.onWidthResizeEnd.bind(this);

  onWidthResizeStart(event: MouseEvent): void {
    if (event.button !== 0) return;
    event.preventDefault();
    this.isResizingWidth.set(true);
    this.widthDragStart = { startX: event.clientX, startWidth: this.contentWidthPx() };
    document.addEventListener('mousemove', this.boundWidthMove);
    document.addEventListener('mouseup', this.boundWidthEnd);
    document.body.style.userSelect = 'none';
  }

  private onWidthResizeMove(event: MouseEvent): void {
    if (!this.widthDragStart) return;
    // Paper is centered, so dragging the right edge by N expands width by 2N
    const delta = (event.clientX - this.widthDragStart.startX) * 2;
    const viewportMax = Math.max(640, window.innerWidth - 80);
    const next = Math.min(viewportMax, Math.max(600, this.widthDragStart.startWidth + delta));
    this.contentWidthPx.set(next);
  }

  private onWidthResizeEnd(): void {
    this.isResizingWidth.set(false);
    this.widthDragStart = null;
    document.removeEventListener('mousemove', this.boundWidthMove);
    document.removeEventListener('mouseup', this.boundWidthEnd);
    document.body.style.userSelect = '';
    this.persistContentWidth(this.contentWidthPx());
  }

  private persistContentWidth(widthPx: number): void {
    const space = this.space();
    if (!space || !this.documentPath) return;
    this.documentSettingsService.updateSettings(space.id, this.documentPath, { contentWidthPx: widthPx })
      .pipe(takeUntil(this.destroy$))
      .subscribe({ error: () => {} });
  }

  private imageDragState: { x: number; y: number; scrollLeft: number; scrollTop: number; el: HTMLElement } | null = null;
  private boundImageDragMove = this.onImageDragMove.bind(this);
  private boundImageDragEnd = this.onImageDragEnd.bind(this);

  zoomIn(): void { this.imageZoom.update(z => Math.min(z + 0.25, 4)); }
  zoomOut(): void { this.imageZoom.update(z => Math.max(z - 0.25, 0.25)); }
  resetZoom(): void { this.imageZoom.set(1); }

  onImageDragStart(event: MouseEvent): void {
    if (event.button !== 0) return;
    const el = event.currentTarget as HTMLElement;
    event.preventDefault();
    this.isDraggingImage.set(true);
    this.imageDragState = { x: event.clientX, y: event.clientY, scrollLeft: el.scrollLeft, scrollTop: el.scrollTop, el };
    document.addEventListener('mousemove', this.boundImageDragMove);
    document.addEventListener('mouseup', this.boundImageDragEnd);
  }

  private onImageDragMove(event: MouseEvent): void {
    if (!this.imageDragState) return;
    const { el, x, y, scrollLeft, scrollTop } = this.imageDragState;
    if (el.scrollWidth > el.clientWidth) el.scrollLeft = scrollLeft - (event.clientX - x);
    if (el.scrollHeight > el.clientHeight) el.scrollTop = scrollTop - (event.clientY - y);
  }

  private onImageDragEnd(): void {
    this.isDraggingImage.set(false);
    this.imageDragState = null;
    document.removeEventListener('mousemove', this.boundImageDragMove);
    document.removeEventListener('mouseup', this.boundImageDragEnd);
  }
  onImageWheel(event: WheelEvent): void {
    event.preventDefault();
    if (event.deltaY < 0) this.zoomIn(); else this.zoomOut();
  }

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private spacesService: SpacesService,
    private documentsService: DocumentsService,
    private documentHistoryService: DocumentHistoryService,
    private aiService: AiService,
    private gitService: GitService,
    private authService: AuthService,
    private sanitizer: DomSanitizer,
    private toastService: ToastService,
    private annotationsService: AnnotationsService,
    private markdownService: MarkdownRenderService,
    private dataFileService: DataFileRenderService,
    private documentSettingsService: DocumentSettingsService,
    private stateExportService: StateExportService,
    protected prefs: DisplayPrefsService,
    protected caps: CapabilitiesService
  ) {
    this.autoSave$.pipe(
      debounceTime(2000),
      takeUntil(this.destroy$)
    ).subscribe(() => {
      if (!this.isGitSpace()) this.saveDocument();
    });

    // Render Mermaid + draw.io diagrams after the read-only HTML is flushed to the DOM.
    effect(() => {
      this.readonlyHtml();
      setTimeout(() => {
        this.markdownService.runMermaid(this.readonlyElement?.nativeElement);
        this.markdownService.runDrawio(this.readonlyElement?.nativeElement);
        this.markdownService.runImageLightbox(this.readonlyElement?.nativeElement);
      }, 0);
    });

    // A .drawio file opened directly: render it via the viewer. Re-runs when
    // the path changes (the host element is reused across navigations).
    effect(() => {
      this.previewUrl();
      if (this.previewType() !== 'drawio') return;
      setTimeout(() => {
        const el = this.drawioElement?.nativeElement;
        if (!el || !el.getAttribute('data-drawio-src')) return;
        el.removeAttribute('data-drawio-rendered');
        el.classList.remove('dv-mermaid-wrap');
        el.innerHTML = '';
        this.markdownService.runDrawio(el.parentElement);
      }, 0);
    });
  }

  @HostListener('document:click')
  onDocumentClick(): void {
    this.showActionMenu.set(false);
    this.showTranslateMenu.set(false);
    this.showTableMenu.set(false);
    this.showHighlightMenu.set(false);
  }

  languageLabel(code: string): string {
    return this.translateLanguages.find(l => l.code === code)?.label ?? code;
  }

  /** Fetch (or reuse the cached) translation for the current document and show it in read view. */
  translateTo(code: string): void {
    const space = this.space();
    if (!space || !this.documentPath || this.translating()) return;
    if (this.translationLang() === code) {
      this.closeActionMenus();
      return;
    }
    this.translatingLang.set(code);
    this.documentsService.translate(space.id, this.documentPath, code)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.translatingLang.set(null);
          this.translationLang.set(code);
          this.viewingAiPrevious.set(false);
          this.viewingVersion.set(null);
          // Surface a newly-created language in the read-mode bar right away.
          if (!this.availableLangs().includes(code)) {
            this.availableLangs.update(langs => [...langs, code].sort());
          }
          this.renderReadView(res.content);
          this.closeActionMenus();
        },
        error: () => {
          this.translatingLang.set(null);
          this.toastService.error('Translation failed', 'Could not translate this document. Please try again.');
        }
      });
  }

  /** Drop the active translation and re-render the original document. */
  showOriginal(): void {
    this.translationLang.set(null);
    this.viewingAiPrevious.set(false);
    this.viewingVersion.set(null);
    this.renderReadView(this.markdownContent());
    this.closeActionMenus();
  }

  /** Delete a cached translation for this document; reverts to the original if it was showing. */
  removeTranslation(code: string): void {
    const space = this.space();
    if (!space || !this.documentPath) return;
    this.documentsService.deleteTranslation(space.id, this.documentPath, code)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {
          this.availableLangs.update(langs => langs.filter(c => c !== code));
          if (this.translationLang() === code) this.showOriginal();
          this.toastService.success('Translation removed', `The ${this.languageLabel(code)} translation was removed.`);
        },
        error: () => this.toastService.error('Could not remove translation', 'Please try again.')
      });
  }

  private closeActionMenus(): void {
    this.showTranslateMenu.set(false);
    this.showActionMenu.set(false);
  }

  /** Open the version-history drawer and load the document's commit track. */
  openHistory(): void {
    this.closeActionMenus();
    this.showHistoryPanel.set(true);
    this.loadHistory();
  }

  private loadHistory(): void {
    const space = this.space();
    if (!space || !this.documentPath) return;
    this.historyLoading.set(true);
    this.documentHistoryService.getHistory(space.id, this.documentPath)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (versions) => {
          this.historyVersions.set(versions);
          this.historyLoading.set(false);
        },
        error: () => {
          this.historyLoading.set(false);
          this.toastService.error('History unavailable', 'Could not load the version history for this document.');
        }
      });
  }

  closeHistory(): void {
    this.showHistoryPanel.set(false);
    if (this.viewingVersion()) this.backToCurrent();
  }

  /** Render the document as it existed at the given version (read-only time capsule). */
  viewVersion(version: DocumentVersion): void {
    const space = this.space();
    if (!space || this.versionLoadingSha()) return;
    if (this.isCurrentVersion(version)) {
      this.backToCurrent();
      return;
    }
    if (this.viewingVersion()?.sha === version.sha && this.historyViewMode() === 'doc') return;
    this.versionLoadingSha.set(version.sha);
    this.documentHistoryService.getVersionContent(space.id, this.documentPath, version.sha)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.versionLoadingSha.set(null);
          this.viewingVersion.set(version);
          this.historyViewMode.set('doc');
          this.translationLang.set(null);
          this.viewingAiPrevious.set(false);
          this.renderReadView(this.stripTitleH1(res.content));
        },
        error: () => {
          this.versionLoadingSha.set(null);
          this.toastService.error('Version unavailable', 'Could not load this version. Please try again.');
        }
      });
  }

  /** Show what the given version's commit changed in this document. */
  viewDiff(version: DocumentVersion): void {
    const space = this.space();
    if (!space || this.versionLoadingSha()) return;
    if (this.viewingVersion()?.sha === version.sha && this.historyViewMode() === 'diff') return;
    this.versionLoadingSha.set(version.sha);
    this.documentHistoryService.getVersionDiff(space.id, this.documentPath, version.sha)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.versionLoadingSha.set(null);
          this.viewingVersion.set(version);
          this.historyViewMode.set('diff');
          this.diffLines.set(this.parseUnifiedDiff(res.diff));
          this.translationLang.set(null);
          this.viewingAiPrevious.set(false);
        },
        error: () => {
          this.versionLoadingSha.set(null);
          this.toastService.error('Changes unavailable', 'Could not load the changes for this version.');
        }
      });
  }

  /** Leave the time capsule and show the live document again. */
  backToCurrent(): void {
    if (!this.viewingVersion()) return;
    this.viewingVersion.set(null);
    this.historyViewMode.set('doc');
    this.diffLines.set([]);
    this.renderReadView(this.markdownContent());
  }

  /**
   * Unified diff → renderable lines. File headers and no-newline markers are
   * dropped; hunk headers stay as separators.
   */
  private parseUnifiedDiff(diff: string): DiffLine[] {
    const skip = /^(diff --git|index |--- |\+\+\+ |new file mode|deleted file mode|old mode|new mode|similarity index|rename from|rename to|\\ No newline)/;
    const lines: DiffLine[] = [];
    for (const raw of diff.split('\n')) {
      if (skip.test(raw)) continue;
      if (raw.startsWith('@@')) lines.push({ type: 'hunk', text: raw });
      else if (raw.startsWith('+')) lines.push({ type: 'add', text: raw.substring(1) });
      else if (raw.startsWith('-')) lines.push({ type: 'del', text: raw.substring(1) });
      else lines.push({ type: 'ctx', text: raw.startsWith(' ') ? raw.substring(1) : raw });
    }
    // The final newline of the diff text splits into a trailing empty context line.
    while (lines.length && lines[lines.length - 1].type === 'ctx' && lines[lines.length - 1].text === '') {
      lines.pop();
    }
    return lines;
  }

  /** Write the viewed version back as a new version on top of the history. */
  restoreVersion(version: DocumentVersion): void {
    const space = this.space();
    if (!space || this.restoring()) return;
    this.restoring.set(true);
    this.documentHistoryService.restoreVersion(space.id, this.documentPath, version.sha)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {
          this.restoring.set(false);
          this.viewingVersion.set(null);
          this.toastService.success('Version restored', 'The document was restored — the previous state stays available in the history.');
          this.loadDocument();
          this.loadHistory();
        },
        error: () => {
          this.restoring.set(false);
          this.toastService.error('Restore failed', 'Could not restore this version. Please try again.');
        }
      });
  }

  /** Same leading-H1 strip rule as loadDocument, for rendering historical content. */
  private stripTitleH1(content: string): string {
    const h1Match = content.match(/^#\s+(.+)\n*/);
    if (h1Match && h1Match[1].trim() === (this.documentTitle || '').trim()) {
      return content.substring(h1Match[0].length);
    }
    return content;
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

  confirmDeleteDocument(): void {
    this.showDeleteConfirm.set(true);
  }

  deleteDocument(): void {
    const space = this.space();
    if (!space || !this.documentPath) return;

    this.deleting.set(true);
    this.documentsService.deleteDocument(space.id, this.documentPath).subscribe({
      next: () => {
        this.deleting.set(false);
        this.showDeleteConfirm.set(false);
        this.toastService.success('Document Deleted', `"${this.documentPath.split('/').pop()}" has been deleted.`);
        this.router.navigate(['..'], { relativeTo: this.route });
      },
      error: (error) => {
        this.deleting.set(false);
        this.toastService.error('Delete Failed', error.error?.message || 'Failed to delete document');
      }
    });
  }

  openFullscreenPreview(): void {
    const space = this.space();
    if (!space) return;
    if (this.documentPath) {
      this.router.navigate(['/preview', space.id, this.documentPath]);
    } else {
      this.router.navigate(['/preview', space.id]);
    }
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

  downloadFile(): void {
    const space = this.space();
    if (!space || !this.documentPath) return;
    this.stateExportService.checkFileUsesState(space.id, this.documentPath).subscribe({
      next: (usesState) => {
        if (usesState) {
          this.showExportStateDialog.set(true);
        } else {
          this.stateExportService.download(space.id, this.documentPath, false);
        }
      },
      error: () => this.stateExportService.download(space.id, this.documentPath, false),
    });
  }

  onExportStateChosen(withState: boolean): void {
    this.showExportStateDialog.set(false);
    const space = this.space();
    if (!space || !this.documentPath) return;
    this.stateExportService.download(space.id, this.documentPath, withState);
  }

  openAiEditDialog(): void {
    this.showAiEditDialog.set(true);
  }

  /** Opens the space AI chat pre-scoped to the current document. */
  openAiChat(): void {
    const space = this.space();
    if (!space) return;
    this.router.navigate(
      spaceRoute(space.fullPath, 'chat'),
      { queryParams: { aboutDoc: this.documentPath } }
    );
  }

  onAiEditApplied(result: AiEditResult): void {
    this.showAiEditDialog.set(false);
    this.aiEditUndo.set({ path: result.path, previousContent: result.previousContent });
    this.viewingAiPrevious.set(false);
    this.loadDocument();
  }

  /** Read-only preview of the version before the AI edit — nothing is written. */
  onAiPreviewPrevious(previousContent: string): void {
    this.translationLang.set(null);
    // Strip a leading H1 matching the title, mirroring loadDocument's read render.
    let content = previousContent;
    const h1Match = content.match(/^#\s+(.+)\n*/);
    if (h1Match && h1Match[1].trim() === this.documentTitle.trim()) {
      content = content.substring(h1Match[0].length);
    }
    this.viewingAiPrevious.set(true);
    this.renderReadView(content);
  }

  /** Leave the previous-version preview and re-render the current document. */
  onAiPreviewCurrent(): void {
    this.viewingAiPrevious.set(false);
    this.renderReadView(this.markdownContent());
  }

  onAiReverted(): void {
    this.aiEditUndo.set(null);
    this.viewingAiPrevious.set(false);
    this.loadDocument();
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
      const lang = params.get('lang');
      if (path) {
        const pathChanged = path !== this.documentPath;
        this.documentPath = path; this.documentPathSignal.set(path);
        // Switching to a different document must start at the top, not inherit
        // the previous document's scroll offset (the container is reused).
        if (pathChanged) {
          setTimeout(() => this.scrollContainer?.nativeElement.scrollTo({ top: 0 }));
          this.aiEditUndo.set(null);
          this.showAiEditDialog.set(false);
          this.viewingAiPrevious.set(false);
        }
        const ext = path.split('.').pop()?.toLowerCase() || '';
        if (EditorComponent.IMAGE_EXTENSIONS.has(ext)) {
          this.isPreviewFile.set(true);
          this.previewType.set('image');
          this.imageZoom.set(1);
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
        } else if (EditorComponent.PDF_EXTENSIONS.has(ext)) {
          this.isPreviewFile.set(true);
          this.previewType.set('pdf');
          this.loading.set(false);
          const space = this.space();
          if (space) {
            const url = `/api/spaces/${space.id}/files/${path}`;
            this.previewUrl.set(url);
            this.safePreviewUrl.set(this.sanitizer.bypassSecurityTrustResourceUrl(url));
          }
        } else if (ext === 'drawio') {
          this.isPreviewFile.set(true);
          this.previewType.set('drawio');
          this.loading.set(false);
          const space = this.space();
          if (space) {
            this.previewUrl.set(`/api/spaces/${space.id}/files/${path}`);
          }
        } else if (EditorComponent.SPREADSHEET_EXTENSIONS.has(ext)) {
          this.isPreviewFile.set(true);
          this.previewType.set('spreadsheet');
          this.spreadsheetHtml.set('');
          this.spreadsheetError.set(null);
          if (this.space()) {
            this.loadSpreadsheet();
          }
        } else {
          this.isPreviewFile.set(false);
          if (pathChanged || this.document() === null) {
            // First load or a different document: remember any ?lang= to apply once the
            // document has rendered. loadDocument runs here, or — on a cold load where the
            // space isn't ready yet — via loadSpace() shortly after; pendingLang persists.
            this.pendingLang = lang;
            if (this.space()) {
              this.loadDocument();
            }
          } else if (lang) {
            // Same document, only the language changed (e.g. clicked a tree translation).
            this.translateTo(lang);
          } else {
            this.showOriginal();
          }
        }
      } else {
        // New document — remember the folder the user created it from so it
        // lands there instead of the default docs/ directory.
        this.newDocFolder = (params.get('folder') ?? '').replace(/^\/+|\/+$/g, '');
        this.isPreviewFile.set(false);
        this.initializeNewDocument();
      }
    });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
    this.editor?.destroy();
    document.removeEventListener('mousemove', this.boundImageDragMove);
    document.removeEventListener('mouseup', this.boundImageDragEnd);
  }

  loadSpace(fullPath: string): void {
    this.spacesService.getSpaceByPath(fullPath).subscribe({
      next: (space) => {
        this.space.set(space);
        this.annotationsService.getMyPermission(space.id).subscribe({
          next: (res) => {
            const level = res.level as AnnotationPermission;
            this.annotationPermission.set(level === 'VIEW' ? 'VIEW' : level === 'EDIT' ? 'EDIT' : level === 'ADMIN' ? 'ADMIN' : 'VIEW');
          },
          error: () => {}
        });
        if (this.isPreviewFile()) {
          if (this.previewType() === 'spreadsheet') {
            this.loadSpreadsheet();
          } else {
            const url = `/api/spaces/${space.id}/files/${this.documentPath}`;
            this.previewUrl.set(url);
            if (this.previewType() === 'html' || this.previewType() === 'pdf') {
              this.safePreviewUrl.set(this.sanitizer.bypassSecurityTrustResourceUrl(url));
            }
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
    this.translationLang.set(null);
    this.availableLangs.set([]);
    this.viewingVersion.set(null);
    if (this.showHistoryPanel()) this.loadHistory();
    this.loadDocumentSettings(space.id, this.documentPath);
    this.loadAvailableTranslations(space.id, this.documentPath);
    this.documentsService.getDocument(space.id, this.documentPath).subscribe({
      next: (doc) => {
        this.document.set(doc);
        this.isNewDocument.set(false);
        this.documentTitle = doc.title || '';
        // Strip leading H1 if it matches the title to avoid duplicate heading.
        // Remember the exact stripped text — saves must re-prepend it, since
        // the backend writes content verbatim.
        let content = doc.content;
        this.strippedH1 = null;
        const h1Match = content.match(/^#\s+(.+)\n*/);
        if (h1Match && h1Match[1].trim() === this.documentTitle.trim()) {
          content = content.substring(h1Match[0].length);
          this.strippedH1 = h1Match[0];
        }
        this.loading.set(false);
        // Documents open in read mode; the user clicks Edit to switch.
        this.markdownContent.set(content);
        this.editMode.set(false);
        setTimeout(() => {
          this.applyView();
          // Apply a translation requested via ?lang= now that the original is rendered.
          const lang = this.pendingLang;
          this.pendingLang = null;
          if (lang) this.translateTo(lang);
        });
      },
      error: () => {
        this.initializeNewDocument();
      }
    });
  }

  private loadAvailableTranslations(spaceId: string, path: string): void {
    this.documentsService.getTranslations(spaceId, path)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (entries) => this.availableLangs.set(entries[0]?.languages ?? []),
        error: () => this.availableLangs.set([])
      });
  }

  private loadDocumentSettings(spaceId: string, filePath: string): void {
    this.documentSettingsService.getSettings(spaceId, filePath)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (settings) => {
          const w = settings?.contentWidthPx;
          if (typeof w === 'number' && w >= 600) {
            this.contentWidthPx.set(w);
          } else {
            this.contentWidthPx.set(EditorComponent.CONTENT_WIDTH_DEFAULT);
          }
        },
        error: () => this.contentWidthPx.set(EditorComponent.CONTENT_WIDTH_DEFAULT)
      });
  }

  initializeNewDocument(): void {
    this.documentTitle = '';
    this.isNewDocument.set(true);
    this.strippedH1 = null;
    this.loading.set(false);
    // A freshly-created document opens straight in edit mode — you made it to write.
    this.markdownContent.set('');
    this.editMode.set(true);
    setTimeout(() => this.applyView());
  }

  /** Render the current document according to the active view (read vs edit). */
  private applyView(): void {
    if (this.showEditor()) {
      this.initTiptap(this.markdownContent());
    } else {
      this.renderReadView(this.markdownContent());
    }
  }

  /** Switch from read mode into the TipTap editor (editable spaces only). */
  enterEditMode(): void {
    if (!this.canEdit()) return;
    this.translationLang.set(null);
    // Editing always starts from the current version, never the AI-previous preview.
    this.viewingAiPrevious.set(false);
    this.editMode.set(true);
    setTimeout(() => this.initTiptap(this.markdownContent()));
  }

  /**
   * Render markdown through the full pipeline (incl. Mermaid / draw.io) into the
   * read-mode article, bypassing TipTap. Used for git-synced files and for any
   * document being viewed in read mode.
   */
  private renderReadView(content: string): void {
    const space = this.space();
    if (!space) return;
    this.editor?.destroy();
    this.editor = null as any;
    const ext = this.documentPath.split('.').pop()?.toLowerCase() || '';
    // Structured data files (JSON/CSV/TSV/TAB/SQL) get a dedicated renderer:
    // pretty JSON, syntax-highlighted SQL and real tables for delimited data,
    // instead of a raw blob dumped through the markdown pipeline.
    if (this.dataFileService.isDataFile(ext)) {
      this.readonlyHtml.set(
        this.sanitizer.bypassSecurityTrustHtml(this.dataFileService.render(content, ext))
      );
      return;
    }
    const docDir = this.currentDocDir();
    // A raw Mermaid file (.mmd/.mermaid) is diagram source with no fence.
    // Wrap it so the markdown pipeline emits a Mermaid block the runMermaid
    // effect can turn into a diagram, instead of showing the source as code.
    const toRender = (ext === 'mmd' || ext === 'mermaid')
      ? '```mermaid\n' + content.trim() + '\n```\n'
      : content;
    this.readonlyHtml.set(this.markdownService.render(
      toRender,
      docDir,
      `/api/spaces/${space.id}/files`,
      `/spaces/${space.fullPath}/doc`
    ));
  }

  /**
   * Fetch a binary spreadsheet (xlsx/xls) and render each sheet as a table.
   * SheetJS is loaded on demand from a self-hosted asset (see loadXlsxLib) so
   * it never enters the bundle — keeping the (very large) parser out of the
   * production build's optimisation step, and only shipping it to clients that
   * actually open a spreadsheet.
   */
  private loadSpreadsheet(): void {
    const space = this.space();
    if (!space || !this.documentPath) return;
    this.loading.set(true);
    this.spreadsheetError.set(null);
    const path = this.documentPath;
    const url = `/api/spaces/${space.id}/files/${path}`;

    Promise.all([
      fetch(url, { credentials: 'include' }).then(res => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.arrayBuffer();
      }),
      this.loadXlsxLib(),
    ])
      .then(([buffer, XLSX]) => {
        const wb = XLSX.read(new Uint8Array(buffer), { type: 'array' });
        const showSheetNames = wb.SheetNames.length > 1;
        const html = wb.SheetNames.map((name: string) => {
          const rows: any[][] = XLSX.utils.sheet_to_json(wb.Sheets[name], {
            header: 1, blankrows: false, defval: '', raw: false
          });
          const stringRows = rows.map(r =>
            (r ?? []).map((c: any) => (c === null || c === undefined) ? '' : String(c))
          );
          const table = this.dataFileService.renderTable(stringRows);
          return showSheetNames
            ? `<h2 class="data-sheet-title">${this.escapeHtml(name)}</h2>${table}`
            : table;
        }).join('\n');
        // Guard against a race where the user navigated to another file mid-fetch.
        if (this.documentPath !== path) return;
        this.spreadsheetHtml.set(this.sanitizer.bypassSecurityTrustHtml(html));
        this.loading.set(false);
      })
      .catch(() => {
        if (this.documentPath !== path) return;
        this.spreadsheetError.set('This spreadsheet could not be read.');
        this.loading.set(false);
      });
  }

  private xlsxLoader?: Promise<any>;

  /** Load the SheetJS UMD bundle from our own assets, once, and resolve the
   *  global it defines. Kept out of the Angular bundle on purpose. */
  private loadXlsxLib(): Promise<any> {
    const existing = (window as any).XLSX;
    if (existing) return Promise.resolve(existing);
    if (this.xlsxLoader) return this.xlsxLoader;
    this.xlsxLoader = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = '/vendor/xlsx.full.min.js';
      script.async = true;
      script.onload = () => {
        const lib = (window as any).XLSX;
        lib ? resolve(lib) : reject(new Error('XLSX failed to initialise'));
      };
      script.onerror = () => {
        this.xlsxLoader = undefined;
        reject(new Error('Failed to load the spreadsheet parser'));
      };
      document.head.appendChild(script);
    });
    return this.xlsxLoader;
  }

  // Relative links inside a rendered doc (e.g. ../ONBOARDING.md) are rewritten by the
  // markdown service to `/spaces/<fullPath>/doc/<resolved>`; intercept the click and
  // reload the target document in place via the `path` query param the editor reads.
  onMarkdownClick(event: MouseEvent): void {
    const space = this.space();
    if (!space) return;
    handleMarkdownClick(event, `/spaces/${space.fullPath}/doc/`, (filePath) => {
      this.router.navigate([], { relativeTo: this.route, queryParams: { path: filePath } });
    });
  }

  private initTiptap(content: string): void {
    const space = this.space();

    const lowlight = createLowlight(common);

    // Convert markdown to HTML for editor
    let htmlContent = marked.parse(content) as string;

    // Rewrite relative image src to serve from API, resolved relative to the document's directory
    if (space) {
      const docDir = this.currentDocDir();
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

    this.editor = new Editor({
      element: el,
      editable: !this.isReadOnly(),
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
        ColorHighlight.configure({
          multicolor: true
        }),
        CodeBlockLowlight.configure({
          lowlight
        })
      ],
      editorProps: {
        handlePaste: (_view, event) => this.handleImageFiles(event.clipboardData?.files),
        handleDrop: (_view, event) => this.handleImageFiles((event as DragEvent).dataTransfer?.files)
      },
      content: htmlContent,
      onUpdate: () => {
        if (!this.isReadOnly()) {
          this.hasChanges.set(true);
          this.lastSaved.set(false);
          this.autoSave$.next();
        }
      }
    });

    // Snapshot for the minimal-diff save: the loaded markdown and what the
    // serializer emits for this document before any user edit.
    this.editSessionOriginal = content;
    this.editSessionBaseline = this.editorMarkdown();
  }

  /**
   * Finish editing: persist any unsaved changes (returning to read mode on
   * success) or, when nothing is dirty, drop straight back to read mode.
   * Needed because non-git spaces autosave, which leaves the Save button with
   * nothing to do — this button is the reliable way back to the read view.
   */
  doneEditing(): void {
    if (this.saving()) return;
    if (this.hasChanges()) {
      this.saveDocument(true);
    } else {
      // Nothing changed — drop back to the loaded content, not the serializer
      // round-trip, so the next edit session still diffs against the real file.
      this.exitToReadView(this.markdownContent());
    }
  }

  /** Current editor content as document-relative markdown (inverse of the load rewrite). */
  private editorMarkdown(): string {
    if (!this.editor) return this.markdownContent();
    let html = this.editor.getHTML();
    // Convert API serving URLs back to document-relative markdown paths so images
    // resolve consistently across save/reload cycles.
    const docDir = this.currentDocDir();
    html = html.replace(
      /(<img\s[^>]*src=")\/api\/spaces\/[^/]+\/files\/([^"]+)(")/g,
      (_match, pre, abs, post) => `${pre}${this.toDocRelativePath(abs, docDir)}${post}`
    );
    return this.turndownService.turndown(html);
  }

  /**
   * Serialized editor content ready to persist: the raw serializer output is
   * merged against the load-time snapshot so unedited blocks keep their
   * original formatting, then the stripped title H1 is re-prepended.
   */
  private serializeForSave(): { body: string; content: string; raw: string } {
    const raw = this.editorMarkdown();
    const body = this.editSessionOriginal !== null && this.editSessionBaseline !== null
      ? mergeMarkdownEdits(this.editSessionOriginal, this.editSessionBaseline, raw)
      : raw;
    return { body, content: this.withTitleHeading(body), raw };
  }

  /** Re-attach the load-time "# Title" line, following a title rename. */
  private withTitleHeading(body: string): string {
    if (!this.strippedH1) return body;
    const originalTitle = this.strippedH1.match(/^#\s+(.+)/)?.[1]?.trim();
    const currentTitle = (this.documentTitle || '').trim();
    if (!currentTitle || originalTitle === currentTitle) return this.strippedH1 + body;
    const newlines = this.strippedH1.substring(this.strippedH1.indexOf('\n'));
    return `# ${currentTitle}${newlines}${body}`;
  }

  /** After a successful save the persisted state becomes the new diff base. */
  private rebaseEditSession(body: string, raw: string): void {
    this.editSessionOriginal = body;
    this.editSessionBaseline = raw;
  }

  saveDocument(returnToRead = false): void {
    const space = this.space();
    if (!space || !this.editor || this.saving()) return;

    const { body, content, raw } = this.serializeForSave();

    this.saving.set(true);

    // Git-backed spaces only persist on commit — without this the file is
    // written to the working tree but lost on the next git sync.
    const isGit = this.isGitSpace();

    if (this.documentPath) {
      // Update existing document
      this.documentsService.updateDocument(space.id, this.documentPath, {
        title: this.documentTitle,
        content,
        autoCommit: isGit,
        commitMessage: isGit ? `Update ${this.documentTitle || this.documentPath}` : undefined
      }).subscribe({
        next: (doc) => {
          this.document.set(doc);
          this.saving.set(false);
          this.lastSaved.set(true);
          this.hasChanges.set(false);
          this.rebaseEditSession(body, raw);
          // Keep the read-view base in sync — without this, leaving the editor
          // after an autosave (Done with no pending changes) shows stale content.
          this.markdownContent.set(body);
          if (this.showHistoryPanel()) this.loadHistory();
          if (returnToRead) this.exitToReadView(body);
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
        content,
        autoCommit: isGit,
        commitMessage: isGit ? `Add ${this.documentTitle || path}` : undefined
      }).subscribe({
        next: (doc) => {
          this.document.set(doc);
          this.documentPath = path; this.documentPathSignal.set(path);
          this.saving.set(false);
          this.lastSaved.set(true);
          this.hasChanges.set(false);
          this.rebaseEditSession(body, raw);
          this.markdownContent.set(body);
          if (this.showHistoryPanel()) this.loadHistory();
          if (returnToRead) this.exitToReadView(body);
        },
        error: () => {
          this.saving.set(false);
        }
      });
    }
  }

  /** Tear down the editor and drop back to the rendered read view after a save. */
  private exitToReadView(content: string): void {
    this.markdownContent.set(content);
    this.editMode.set(false);
    setTimeout(() => this.renderReadView(content));
  }

  saveAndCommit(): void {
    const space = this.space();
    const user = this.authService.user();
    if (!space || !this.editor || !user) return;

    const { body, content, raw } = this.serializeForSave();

    this.saving.set(true);

    const path = this.documentPath || this.generatePath();

    this.documentsService.updateDocument(space.id, path, {
      title: this.documentTitle,
      content,
      autoCommit: true,
      commitMessage: `Update ${this.documentTitle || path}`
    }).subscribe({
      next: (doc) => {
        this.document.set(doc);
        this.documentPath = path; this.documentPathSignal.set(path);
        this.saving.set(false);
        this.lastSaved.set(true);
        this.hasChanges.set(false);
        this.rebaseEditSession(body, raw);
        this.markdownContent.set(body);
        if (this.showHistoryPanel()) this.loadHistory();
      },
      error: () => {
        this.saving.set(false);
      }
    });
  }

  generatePath(): string {
    const title = this.documentTitle || 'untitled';
    const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'untitled';
    const dir = this.newDocFolder || 'docs';
    return `${dir}/${slug}.md`;
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

  /** Directory of the current document within the repo, e.g. "Anleitungen/Coder/" ('' at root). */
  private currentDocDir(): string {
    return this.documentPath ? this.documentPath.substring(0, this.documentPath.lastIndexOf('/') + 1) : '';
  }

  /** Turn a repo-root-relative path into one relative to the document's directory (inverse of load). */
  private toDocRelativePath(absPath: string, docDir: string): string {
    const from = docDir.split('/').filter(Boolean);
    const to = absPath.split('/').filter(Boolean);
    let i = 0;
    while (i < from.length && i < to.length && from[i] === to[i]) i++;
    const up = from.slice(i).map(() => '..');
    const down = to.slice(i);
    return [...up, ...down].join('/') || absPath;
  }

  /** Triggered by the toolbar image button's hidden file input. */
  onImageInputChange(event: globalThis.Event): void {
    const input = event.target as HTMLInputElement;
    this.handleImageFiles(input.files);
  }

  /**
   * Upload any image files (from paste, drop, or the picker) into an `_assets/` folder next to
   * the document and insert them at the cursor. Returns true when at least one image was handled
   * so TipTap suppresses its default paste/drop behaviour.
   */
  private handleImageFiles(files: FileList | null | undefined): boolean {
    if (this.isReadOnly() || !files || files.length === 0) return false;
    const images = Array.from(files).filter((f) => f.type.startsWith('image/'));
    if (images.length === 0) return false;
    for (const image of images) {
      this.uploadAndInsertImage(image);
    }
    return true;
  }

  private uploadAndInsertImage(file: File): void {
    const space = this.space();
    if (!space || !this.editor) return;

    const docDir = this.currentDocDir();
    const ext = (file.name.split('.').pop() || file.type.split('/').pop() || 'png').toLowerCase();
    // Clipboard images arrive as a generic "image.png" — give each a unique, sortable name.
    const named = new File([file], `paste-${Date.now()}.${ext}`, { type: file.type });
    const folder = `${docDir}_assets`;

    this.toastService.success('Uploading image…', named.name);
    this.documentsService.uploadFiles(space.id, [named], folder).subscribe({
      next: (uploaded) => {
        const path = uploaded[0]?.path;
        if (!path) return;
        // Insert with the API serving URL so it renders in the editor; saveDocument()
        // converts it back to a document-relative markdown path.
        const src = `/api/spaces/${space.id}/files/${path}`;
        this.editor?.chain().focus().setImage({ src }).run();
      },
      error: (err) => {
        this.toastService.error('Image upload failed', err?.error?.message ?? 'Could not upload the image.');
      }
    });
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

  setHighlight(color: string): void {
    this.editor?.chain().focus().setHighlight({ color }).run();
    this.showHighlightMenu.set(false);
  }

  unsetHighlight(): void {
    this.editor?.chain().focus().unsetHighlight().run();
    this.showHighlightMenu.set(false);
  }

  toggleCodeBlock(): void {
    this.editor?.chain().focus().toggleCodeBlock().run();
  }

  insertTable(): void {
    this.editor?.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run();
  }

  addColumnBefore(): void {
    this.editor?.chain().focus().addColumnBefore().run();
  }

  addColumnAfter(): void {
    this.editor?.chain().focus().addColumnAfter().run();
  }

  addRowBefore(): void {
    this.editor?.chain().focus().addRowBefore().run();
  }

  addRowAfter(): void {
    this.editor?.chain().focus().addRowAfter().run();
  }

  deleteColumn(): void {
    this.editor?.chain().focus().deleteColumn().run();
  }

  deleteRow(): void {
    this.editor?.chain().focus().deleteRow().run();
  }

  toggleHeaderRow(): void {
    this.editor?.chain().focus().toggleHeaderRow().run();
  }

  deleteTable(): void {
    this.editor?.chain().focus().deleteTable().run();
    this.showTableMenu.set(false);
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
