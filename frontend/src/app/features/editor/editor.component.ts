import { Component, OnInit, OnDestroy, signal, computed, ViewChild, ElementRef, HostListener, effect, inject } from '@angular/core';
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
import { DocumentsService, DocumentContent, UploadedFile } from '../../core/api/documents.service';
import { HttpResponse } from '@angular/common/http';
import { DocumentHistoryService, DocumentVersion, DocumentHistoryMeta } from '../../core/api/document-history.service';
import { CapabilitiesService } from '../../core/capabilities/capabilities.service';
import { PdfExportService } from '../../core/api/pdf-export.service';
import { AnnotationsService, AnnotationPermission } from '../../core/api/annotations.service';
import { AiService, AiEditResult } from '../../core/api/ai.service';
import { isAiEditable, isUnrenderable, getFileIconGlyph, VIDEO_EXTENSIONS, AUDIO_EXTENSIONS } from '../../shared/utils/file-utils';
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
import { describeSaveError, NOTHING_TO_SAVE } from '../../shared/utils/save-error';
import { AutosizeTextareaDirective } from '../../shared/directives/autosize-textarea.directive';
import { FileTreeSyncService } from '../../shared/services/file-tree-sync.service';
import { BrandingService } from '../../core/branding/branding.service';
import { ScrollAnchor, captureScrollAnchor, restoreScrollAnchor } from '../../shared/utils/scroll-anchor';
import { VersionHistoryPanelComponent } from '../../shared/components/version-history-panel.component';
import { HtmlEditorComponent } from './html-editor.component';
import { HasUnsavedChanges } from '../../core/guards/unsaved-changes.guard';
import { Observable, Subject, debounceTime, filter, lastValueFrom, takeUntil } from 'rxjs';
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

/** One H1/H2 entry of the read-view outline rail. */
interface OutlineItem {
  text: string;
  level: 1 | 2;
  el: HTMLElement;
}

/**
 * One sheet of a workbook as the editor shows it.
 *
 * The grid is walked from the sheet's declared range rather than built from
 * `sheet_to_json`, because that helper drops blank rows — which silently shifts
 * every row below one, so grid coordinates would no longer map to the cell
 * addresses a save has to write back to.
 */
interface SheetView {
  name: string;
  /** Displayed text per cell, row-major over the sheet's used range. */
  rows: string[][];
  /** Cells carrying a formula; editing one replaces it with a literal. */
  formulaAt: boolean[][];
  /** Top-left of the used range — grid (0,0) is this cell. */
  origin: { r: number; c: number };
}

@Component({
  selector: 'app-editor',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, SpaceRoutePipe, ShareLinkDialogComponent, AnnotationOverlayComponent, AiEditDialogComponent, AiEditStepBackComponent, ExportStateDialogComponent, AutosizeTextareaDirective, VersionHistoryPanelComponent, HtmlEditorComponent],
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
        <ng-container *ngTemplateOutlet="docMetaStrip"></ng-container>
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
            <button class="btn-save" (click)="doneEditing()" [disabled]="saving()" [title]="needsSave() ? 'Save and view' : 'Done editing'">
              @if (needsSave()) {
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
          @if (!showEditor() && canEdit() && !viewingVersion() && !notFound()) {
            <button class="btn-edit" (click)="enterEditMode()" title="Edit document">
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg>
              Edit
            </button>
          }
          @if (documentPath && !notFound()) {
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
        <div class="preview-topbar" [class.with-history-panel]="showHistoryPanel()">
          <div class="preview-filename">
            <span translate="no" class="material-icons preview-file-icon">{{ previewType() === 'html' ? 'code' : previewType() === 'pdf' ? 'picture_as_pdf' : previewType() === 'drawio' ? 'schema' : previewType() === 'spreadsheet' ? 'grid_on' : 'image' }}</span>
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
          <ng-container *ngTemplateOutlet="docMetaStrip"></ng-container>
          <div class="preview-topbar-actions">
          @if (canEditHtmlFile()) {
            <button
              class="btn-edit"
              (click)="startHtmlEdit()"
              title="Edit this page — alpha: editing a page through the browser can reformat its markup, so check the result before you save"
            >
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg>
              Edit
              <span class="btn-badge">alpha</span>
            </button>
          }
          @if (canEditSpreadsheet()) {
            <button
              class="btn-edit"
              (click)="startSheetEdit()"
              title="Edit cell values — alpha: charts, styling and anything Excel-specific this editor cannot model are not preserved, so check the result before you save"
            >
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg>
              Edit
              <span class="btn-badge">alpha</span>
            </button>
          }
          @if (sheetEditMode()) {
            <button class="btn-edit" (click)="cancelSheetEdit()" [disabled]="savingSheet()">Cancel</button>
            <button
              class="btn-edit btn-edit-primary"
              (click)="saveSpreadsheet()"
              [disabled]="!sheetDirty() || savingSheet()"
            >{{ savingSheet() ? 'Saving…' : 'Save' }}</button>
          }
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
                @if (canViewVersions()) {
                  <button class="action-menu-item" (click)="openHistory(); showActionMenu.set(false)">
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
              </div>
            }
          </div>
          </div>
        </div>
        @if (htmlEditMode() && space()) {
          <app-html-editor
            [spaceId]="space()!.id"
            [path]="documentPath"
            (saved)="onHtmlSaved()"
            (closed)="htmlEditMode.set(false)"
          />
        } @else {
        <!-- Scrollable preview content -->
        <div #scrollContainer class="flex-1 overflow-y-auto editor-bg" [class.with-history-panel]="showHistoryPanel()" [class.pane-fill]="showsSheetPane()">
          <ng-container *ngTemplateOutlet="aiUndoBanner"></ng-container>
          <ng-container *ngTemplateOutlet="timeCapsuleBanner"></ng-container>
          @if (viewingVersion() && historyViewMode() === 'diff') {
            <ng-container *ngTemplateOutlet="diffView"></ng-container>
          } @else if (previewType() === 'html') {
            <div class="html-preview-container annotation-host">
              @if (safePreviewUrl(); as src) {
                <iframe [src]="src" class="preview-iframe" sandbox="allow-scripts allow-same-origin"></iframe>
              }
              <!-- Comments belong to the live page; a historic version has no
                   pins to place and its markup no longer matches theirs. -->
              @if (space() && documentPath && !viewingVersion()) {
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
              @if (safePreviewUrl(); as src) {
                <iframe [src]="src" class="preview-iframe"></iframe>
              }
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
          } @else if (previewType() === 'download') {
            <div class="media-preview-container">
              <div class="unsupported-card">
                <span translate="no" class="material-icons unsupported-icon">{{ fileGlyph(documentPath) }}</span>
                <h2 class="unsupported-name">{{ documentPath.split('/').pop() }}</h2>
                <p class="unsupported-hint">{{ branding.appName() }} can't show this kind of file. You can download it and open it locally.</p>
                <a class="unsupported-download" [href]="previewUrl() + '?download=true'" download>
                  <span translate="no" class="material-icons">download</span>
                  Download file
                </a>
              </div>
            </div>
          } @else if (previewType() === 'video' || previewType() === 'audio') {
            <div class="media-preview-container">
              @if (previewType() === 'video') {
                <!-- The backend answers Range requests, so this streams and seeks
                     rather than waiting for the whole file. -->
                <video
                  class="media-player media-video"
                  [src]="previewUrl()"
                  controls
                  preload="metadata"
                  playsinline
                ></video>
              } @else {
                <div class="media-audio-card">
                  <span translate="no" class="material-icons media-audio-icon">audiotrack</span>
                  <span class="media-audio-name">{{ documentPath.split('/').pop() }}</span>
                  <audio class="media-player" [src]="previewUrl()" controls preload="metadata"></audio>
                </div>
              }
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
                <!-- One tab per sheet, like the workbook's own tab strip. Stacking
                     the sheets instead hid every sheet but the first behind a
                     few thousand rows of the one above it. -->
                @if (sheets().length > 1) {
                  <div class="sheet-tabs" role="tablist">
                    @for (sheet of sheets(); track $index; let i = $index) {
                      <button
                        type="button"
                        role="tab"
                        class="sheet-tab"
                        [class.active]="i === activeSheetIndex()"
                        [attr.aria-selected]="i === activeSheetIndex()"
                        [title]="sheet.name"
                        (click)="activeSheetIndex.set(i)"
                      >{{ sheet.name }}</button>
                    }
                  </div>
                }
                @if (xlsxBlockedReason(); as reason) {
                  <p class="sheet-blocked">
                    <span translate="no" class="material-icons">lock</span>
                    {{ reason }}
                  </p>
                }
                @if (sheetEditMode() && activeSheet(); as sheet) {
                  <!-- Editable grid. Rendered as real inputs rather than the
                       read-only HTML so a cell keeps its position in the sheet
                       even when it is blank. -->
                  <div class="sheet-scroll sheet-edit">
                    <table class="data-table">
                      <tbody>
                        @for (row of sheet.rows; track $index; let r = $index) {
                          <tr>
                            @for (cell of row; track $index; let c = $index) {
                              <td [class.has-formula]="sheet.formulaAt[r][c]">
                                <input
                                  class="sheet-cell"
                                  [value]="cell"
                                  [title]="sheet.formulaAt[r][c] ? 'This cell is calculated — typing here replaces the formula with a fixed value' : ''"
                                  (change)="onCellEdit(r, c, $event)"
                                />
                              </td>
                            }
                          </tr>
                        }
                      </tbody>
                    </table>
                  </div>
                } @else {
                  <div class="sheet-scroll" [innerHTML]="activeSheetHtml()"></div>
                }
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
        }
      } @else {
        <!-- Editor Area -->
        <div #scrollContainer class="flex-1 overflow-y-auto editor-bg" (scroll)="onContentScroll()">
          @if (outlineVisible()) {
            <!-- Zero-height sticky rail so the centered paper's layout is untouched -->
            <div class="doc-outline-rail">
              <nav class="doc-outline" aria-label="Document outline">
                @for (item of docOutline(); track $index) {
                  <button
                    type="button"
                    class="doc-outline-item"
                    [class.doc-outline-h2]="item.level === 2"
                    [class.active]="activeOutlineIndex() === $index"
                    [title]="item.text"
                    (click)="scrollToHeading(item, $index)"
                  >{{ item.text }}</button>
                }
              </nav>
            </div>
          }
          <div class="mx-auto px-8 py-6 paper" [class.paper-full]="isDataView()" [style.maxWidth.px]="isDataView() ? null : contentWidthPx()">
            @if (loading()) {
              <div class="flex items-center justify-center py-12">
                <svg class="animate-spin h-8 w-8 text-primary-600" fill="none" viewBox="0 0 24 24">
                  <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                  <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                </svg>
              </div>
            } @else if (notFound()) {
              <div class="doc-not-found">
                <span translate="no" class="material-icons doc-not-found-icon">search_off</span>
                <h2>File not found</h2>
                <p>There is no document at <code>{{ documentPath }}</code> in this space. The link may be outdated or mistyped.</p>
                <div class="doc-not-found-actions">
                  @if (space(); as sp) {
                    <a [routerLink]="sp.fullPath | spaceRoute" class="btn btn-primary">
                      <span translate="no" class="material-icons">home</span>
                      Space overview
                    </a>
                    <a [routerLink]="sp.fullPath | spaceRoute: 'doc'" [queryParams]="{ folder: notFoundFolder() || null }" class="btn btn-secondary">
                      <span translate="no" class="material-icons">add</span>
                      New document{{ notFoundFolder() ? ' in ' + notFoundFolder() : '' }}
                    </a>
                  }
                </div>
              </div>
            } @else {
              <!-- textarea, not input: a long title has to wrap, and an input
                   would clip it with nothing to show the value continues. -->
              <textarea
                #titleField
                appAutosize
                rows="1"
                [(ngModel)]="documentTitle"
                (ngModelChange)="onTitleChanged()"
                (keydown.enter)="$event.preventDefault()"
                placeholder="Untitled"
                [readonly]="!showEditor()"
                class="editor-title"
              ></textarea>

              <ng-container *ngTemplateOutlet="aiUndoBanner"></ng-container>

              @if (!showEditor()) {
                <!-- Read mode: full markdown pipeline incl. Mermaid + image lightbox -->
                <ng-container *ngTemplateOutlet="timeCapsuleBanner"></ng-container>
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
                  <ng-container *ngTemplateOutlet="diffView"></ng-container>
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
                <!-- translate="no": browser page translation rewrites the text
                     nodes in place, and TipTap would read that back as an edit
                     and commit the translated prose to Git on the next save. -->
                <div
                  #editorElement
                  translate="no"
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
                [docHash]="anchorDocHash()"
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


      <!-- Creator + last editor of the file, with the way into its history.
           Shown above a markdown document and in the preview topbar of a file
           that is rendered rather than edited — both are git-tracked files, so
           both have a history to show. -->
      <ng-template #docMetaStrip>
        @if (historyMeta(); as meta) {
          <div class="editor-doc-meta">
            @if (meta.created; as created) {
              <span class="editor-doc-meta-item" [title]="created.authorEmail || ''">
                Created by {{ created.authorName || 'unknown' }} · {{ created.committedAt | date:'MMM d, y, HH:mm' }}
              </span>
            }
            @if (meta.lastEdited && meta.lastEdited.sha !== meta.created?.sha) {
              <span class="editor-doc-meta-divider"></span>
              <span class="editor-doc-meta-item" [title]="meta.lastEdited!.authorEmail || ''">
                Last edited by {{ meta.lastEdited!.authorName || 'unknown' }} · {{ meta.lastEdited!.committedAt | date:'MMM d, y, HH:mm' }}
              </span>
            }
            @if (!showEditor() && canViewVersions()) {
              <button class="editor-doc-meta-history" (click)="openHistory()" title="Open version history">
                <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/>
                </svg>
                History
              </button>
            }
          </div>
        }
      </ng-template>

      <ng-template #timeCapsuleBanner>
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
      </ng-template>

      <ng-template #diffView>
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
      </ng-template>

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
          <span translate="no" class="material-icons">auto_awesome</span>
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
        <app-version-history-panel
          [versions]="historyVersions()"
          [loading]="historyLoading()"
          [activeSha]="viewingVersion()?.sha ?? null"
          [loadingSha]="versionLoadingSha()"
          [diffActive]="historyViewMode() === 'diff'"
          (view)="viewVersion($event)"
          (diff)="viewDiff($event)"
          (closed)="closeHistory()"
        />
      }

      @if (confirmSheetLeave()) {
        <div class="sheet-leave-overlay" (click)="answerSheetLeave(false)">
          <div class="sheet-leave-modal" (click)="$event.stopPropagation()">
            <h2>Leave without saving?</h2>
            <p>
              {{ documentPath.split('/').pop() }} has cell changes that were never
              saved. Leaving this page throws them away.
            </p>
            <div class="sheet-leave-actions">
              <button type="button" class="btn-edit" (click)="answerSheetLeave(false)">Keep editing</button>
              <button type="button" class="btn-edit btn-edit-danger" (click)="answerSheetLeave(true)">
                Leave without saving
              </button>
            </div>
          </div>
        </div>
      }
    </div>
  `,
  styles: [`
    :host {
      display: block;
      height: 100%;
      position: relative;
      /* Matches the drawer's own width in version-history-panel.component. */
      --history-drawer-width: 320px;
    }

    // The history drawer is an overlay, so a full-width preview would sit
    // underneath it — including the time-capsule buttons, which are exactly
    // what you reach for while the drawer is open. Move the pane aside instead.
    .preview-topbar.with-history-panel {
      padding-right: calc(var(--history-drawer-width) + 16px);
    }

    .editor-bg.with-history-panel {
      padding-right: var(--history-drawer-width);
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

      &:disabled { opacity: 0.5; cursor: default; }
      &:disabled:hover { background: var(--surface); border-color: var(--border); color: var(--text-primary); }
    }

    .sheet-leave-overlay {
      position: fixed;
      inset: 0;
      z-index: 1100;
      display: flex;
      align-items: center;
      justify-content: center;
      background: rgba(0, 0, 0, 0.45);
    }

    .sheet-leave-modal {
      width: min(420px, calc(100vw - 32px));
      padding: 20px;
      background: var(--surface);
      border-radius: 12px;
      box-shadow: 0 16px 48px rgba(0, 0, 0, 0.2);

      h2 { margin: 0 0 8px; font-size: 1rem; font-weight: 600; }
      p { margin: 0 0 16px; font-size: 13px; color: var(--text-secondary); }
    }

    .sheet-leave-actions { display: flex; justify-content: flex-end; gap: 8px; }

    .btn-edit-danger, .btn-edit-danger:hover {
      background: #b3261e;
      border-color: #b3261e;
      color: #fff;
    }

    .btn-edit-primary, .btn-edit-primary:hover, .btn-edit-primary:disabled:hover {
      background: var(--primary-dark);
      border-color: var(--primary-dark);
      color: #fff;
    }

    /* Early-access marker on the action that opens the HTML editor. The tint
       carries the accent, the text colour comes from the theme's own secondary
       ink — teal-on-teal at this size does not clear the contrast floor. */
    .btn-badge {
      padding: 1px 6px;
      border-radius: 999px;
      background: color-mix(in srgb, var(--primary) 18%, transparent);
      color: var(--text-primary);
      font-size: 0.625rem;
      font-weight: 600;
      letter-spacing: 0.03em;
      line-height: 1.5;
    }

    .text-muted { color: var(--text-muted); }

    .doc-not-found {
      text-align: center;
      padding: 48px 16px;

      h2 {
        font-size: 22px;
        font-weight: 600;
        color: var(--text-primary);
        margin: 0 0 8px;
      }

      p {
        color: var(--text-muted);
        line-height: 1.6;
        margin: 0 0 24px;
        overflow-wrap: anywhere;
      }

      code {
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        font-size: 0.9em;
        color: var(--text-secondary);
      }
    }

    .doc-not-found-icon {
      font-size: 56px;
      color: var(--text-muted);
      margin-bottom: 12px;
    }

    .doc-not-found-actions {
      display: flex;
      justify-content: center;
      gap: 12px;
      flex-wrap: wrap;
    }

    .editor-title {
      display: block;
      width: 100%;
      font-size: 1.875rem;
      font-weight: 700;
      color: var(--text-primary);
      border: none;
      outline: none;
      margin-bottom: 24px;
      background: transparent;
      /* A textarea inherits none of these from the page the way an input did. */
      font-family: inherit;
      line-height: 1.25;
      padding: 0;
      resize: none;
      /* The autosize directive owns the height; a scrollbar would mean it failed. */
      overflow: hidden;

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
      gap: 16px;
      padding: 0 16px;
      height: 44px;
      flex-shrink: 0;
      background: var(--surface);
      border-bottom: 1px solid var(--border);
    }

    .preview-topbar-actions {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    // The bar is a fixed 44px single line, so both the path and the authorship
    // line have to give way rather than wrap. The authorship line is the longer
    // of the two and yields first — the file's own name stays readable, and the
    // created-by half drops out entirely before the last edit does.
    .preview-topbar .editor-doc-meta {
      font-size: 12px;
      min-width: 0;
      overflow: hidden;
    }

    .preview-topbar .editor-doc-meta-item {
      overflow: hidden;
      text-overflow: ellipsis;
    }

    // The divider exists only when the file has been edited since it was
    // created, so it is also the test for "there is a second half to drop".
    @media (max-width: 1500px) {
      .preview-topbar .editor-doc-meta:has(.editor-doc-meta-divider) .editor-doc-meta-item:first-child,
      .preview-topbar .editor-doc-meta-divider {
        display: none;
      }
    }

    .preview-filename {
      display: flex;
      align-items: center;
      gap: 6px;
      min-width: 0;
      flex-shrink: 0;
      white-space: nowrap;
      overflow: hidden;
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

    // Creator / last-editor meta on the right edge of the breadcrumb row.
    .editor-doc-meta {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-left: auto;
      color: var(--text-muted);
    }

    .editor-doc-meta-item {
      white-space: nowrap;
    }

    .editor-doc-meta-divider {
      width: 1px;
      height: 12px;
      background: var(--border);
    }

    .editor-doc-meta-history {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 2px 6px;
      border-radius: 4px;
      color: var(--text-secondary);
      cursor: pointer;
      white-space: nowrap;

      &:hover {
        background: var(--background);
        color: var(--text-primary);
      }
    }

    .annotation-host { position: relative; }

    // "On this page" outline rail. The zero-height sticky wrapper keeps the
    // centered paper's layout untouched; the nav floats in the left gap.
    .doc-outline-rail {
      position: sticky;
      top: 0;
      height: 0;
      overflow: visible;
      z-index: 5;
    }

    .doc-outline {
      position: absolute;
      top: 24px;
      left: 16px;
      width: 220px;
      max-height: calc(100vh - 260px);
      overflow-y: auto;
      display: flex;
      flex-direction: column;
      gap: 2px;
      padding: 4px;
    }

    .doc-outline-item {
      text-align: left;
      font-size: 12px;
      line-height: 1.4;
      color: var(--text-muted);
      padding: 4px 8px;
      border-radius: 6px;
      cursor: pointer;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;

      &:hover {
        color: var(--text-primary);
        background: var(--surface);
      }

      &.active {
        color: var(--primary-dark);
        background: var(--surface);
        font-weight: 600;
      }
    }

    .doc-outline-h2 {
      padding-left: 22px;
    }

    .html-preview-container,
    .pdf-preview-container {
      flex: 1;
      display: flex;
      min-height: 100%;
    }

    // A spreadsheet does its own scrolling: the pane fills the viewport and the
    // sheet scrolls inside it, so the tab strip and the header row stay put and
    // the pane's background follows a sideways scroll. Letting the page scroll
    // instead left the background (and every fixed chrome element) behind at the
    // viewport edge.
    .editor-bg.pane-fill {
      display: flex;
      flex-direction: column;
      overflow: hidden;

      // Only the sheet pane takes the leftover height; a time-capsule or AI-undo
      // banner above it keeps its own.
      > *:not(.spreadsheet-preview-container) {
        flex: none;
      }
    }

    // Spreadsheet (xlsx/xls) preview: full-width, no paper column, so wide
    // sheets use the available space instead of being squeezed.
    .spreadsheet-preview-container {
      flex: 1;
      min-height: 0;
      display: flex;
      flex-direction: column;
      background: var(--surface);
    }

    .sheet-blocked {
      display: flex;
      align-items: center;
      gap: 8px;
      margin: 0 0 10px;
      padding: 8px 12px;
      font-size: 13px;
      color: var(--text-secondary);
      background: var(--background);
      border: 1px solid var(--border);
      border-radius: var(--radius-md);

      .material-icons { font-size: 16px; }
    }

    .sheet-edit .sheet-cell {
      width: 100%;
      min-width: 90px;
      padding: 2px 4px;
      font: inherit;
      color: inherit;
      background: transparent;
      border: none;
      outline: none;

      &:focus { background: var(--surface); box-shadow: inset 0 0 0 2px var(--primary); border-radius: 2px; }
    }

    /* A calculated cell is marked, because typing into one trades the formula
       for whatever was typed — worth seeing before you do it, not after. */
    .sheet-edit td.has-formula {
      background: var(--border-light);
    }

    .sheet-tabs {
      flex: none;
      display: flex;
      gap: 2px;
      padding: 8px 16px 0;
      border-bottom: 1px solid var(--border);
      background: var(--surface);
      overflow-x: auto;
    }

    .sheet-tab {
      flex: none;
      padding: 6px 14px;
      border: 1px solid transparent;
      border-bottom: none;
      border-radius: var(--radius-sm) var(--radius-sm) 0 0;
      background: none;
      color: var(--text-secondary);
      font-size: 13px;
      font-weight: 500;
      white-space: nowrap;
      max-width: 260px;
      overflow: hidden;
      text-overflow: ellipsis;
      cursor: pointer;

      &:hover {
        background: var(--background-darker);
        color: var(--text-primary);
      }

      &.active {
        background: var(--background-darker);
        border-color: var(--border);
        color: var(--primary-dark);
        font-weight: 600;
      }
    }

    // No padding at the top: the sticky header row sticks to the scrollport
    // edge, and rows would otherwise show through the gap above it.
    .sheet-scroll {
      flex: 1;
      min-height: 0;
      overflow: auto;
      padding: 0 24px 24px;
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
export class EditorComponent implements OnInit, OnDestroy, HasUnsavedChanges {
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
  @ViewChild(AutosizeTextareaDirective) private titleAutosize?: AutosizeTextareaDirective;
  private readonly treeSync = inject(FileTreeSyncService);
  protected readonly branding = inject(BrandingService);
  @ViewChild('scrollContainer') scrollContainer?: ElementRef<HTMLElement>;
  @ViewChild(HtmlEditorComponent) private htmlEditor?: HtmlEditorComponent;

  private static readonly IMAGE_EXTENSIONS = new Set([
    'jpg', 'jpeg', 'png', 'gif', 'svg', 'webp', 'bmp', 'ico', 'avif'
  ]);
  private static readonly HTML_EXTENSIONS = new Set(['html', 'htm']);
  private static readonly PDF_EXTENSIONS = new Set(['pdf']);
  // Binary spreadsheets — fetched as bytes and parsed client-side into tables.
  private static readonly VIDEO_EXTENSIONS = VIDEO_EXTENSIONS;
 static readonly AUDIO_EXTENSIONS = AUDIO_EXTENSIONS;
 static readonly SPREADSHEET_EXTENSIONS = new Set(['xlsx', 'xls']);

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
  /**
   * Git-backed spaces only: the content is autosaved on the server but has not
   * been committed yet. Cleared by any save that commits.
   */
  pendingCommit = signal(false);
  /** Last content the server acknowledged — what a deferred commit has to send. */
  private lastPersistedContent: string | null = null;
  /** Guards against a save-failure toast per keystroke while the backend is down. */
  private saveErrorNotified = false;
  /** The Save button still has work to do: unsaved edits, or an uncommitted autosave. */
  needsSave = computed(() => this.hasChanges() || this.pendingCommit());
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
  // Creator + last editor for the breadcrumb topbar, from the document's git track.
  historyMeta = signal<DocumentHistoryMeta | null>(null);
  historyLoading = signal(false);
  versionLoadingSha = signal<string | null>(null);
  viewingVersion = signal<DocumentVersion | null>(null);
  // 'doc' renders the version's content, 'diff' what its commit changed.
  historyViewMode = signal<'doc' | 'diff'>('doc');
  diffLines = signal<DiffLine[]>([]);
  restoring = signal(false);
  isCurrentVersion = (version: DocumentVersion) => version.sha === this.historyVersions()[0]?.sha;
  gitLinkCopied = signal(false);
  // "On this page" outline: H1/H2 of the rendered read view, shown as a
  // sticky rail in the gap left of the paper when the viewport has room.
  docOutline = signal<OutlineItem[]>([]);
  activeOutlineIndex = signal(0);
  outlineFits = signal(true);
  outlineVisible = computed(() =>
    this.docOutline().length > 0 &&
    this.outlineFits() &&
    !this.loading() &&
    !this.showEditor() &&
    !(this.viewingVersion() && this.historyViewMode() === 'diff')
  );
  isPreviewFile = signal(false);
  previewType = signal<'image' | 'html' | 'pdf' | 'drawio' | 'spreadsheet' | 'video' | 'audio' | 'download'>('image');
  previewUrl = signal('');
  // One entry per sheet of a spreadsheet (xlsx/xls) preview, in workbook order.
  sheets = signal<SheetView[]>([]);
  activeSheetIndex = signal(0);
  activeSheet = computed<SheetView | undefined>(() => this.sheets()[this.activeSheetIndex()]);
  activeSheetHtml = computed<SafeHtml>(() => {
    const sheet = this.activeSheet();
    return sheet
      ? this.sanitizer.bypassSecurityTrustHtml(this.dataFileService.renderTable(sheet.rows))
      : '';
  });
  spreadsheetError = signal<string | null>(null);

  // --- Spreadsheet editing -------------------------------------------------
  /**
   * The parsed workbook, kept so a save can change the edited cells *in it* and
   * write that back. Rebuilding a workbook from the displayed strings instead
   * would drop every formula, number format, merge and column width — the grid
   * shows formatted text, not the underlying model.
   */
  private xlsxWorkbook: any = null;
  /** Pending cell edits, keyed `sheetIndex:row:col` (grid coordinates). */
  private xlsxEdits = new Map<string, string>();
  /** False when the workbook holds things this editor would silently destroy. */
  xlsxEditable = signal(false);
  /** Why editing is refused, shown instead of the Edit button. */
  xlsxBlockedReason = signal<string | null>(null);
  sheetEditMode = signal(false);
  sheetDirty = signal(false);
  savingSheet = signal(false);
  /** Showing the "leave without saving?" prompt for unsaved cell edits. */
  confirmSheetLeave = signal(false);
  private sheetLeaveAnswer?: Subject<boolean>;
  /** The Edit affordance for a spreadsheet, mirroring canEditHtmlFile. */
  canEditSpreadsheet = computed(() =>
    this.isPreviewFile() &&
    this.previewType() === 'spreadsheet' &&
    !this.sheetEditMode() &&
    !this.viewingVersion() &&
    this.xlsxEditable() &&
    this.canWriteFiles()
  );
  /** The sheet pane is on screen — a diff of an old version takes precedence. */
  showsSheetPane = computed(() =>
    this.previewType() === 'spreadsheet' &&
    !(this.viewingVersion() && this.historyViewMode() === 'diff')
  );
  /**
   * Null until the space is known and a real URL can be trusted. It must not
   * start as `''`: an empty string is not a SafeResourceUrl, so binding it to an
   * iframe throws NG0904 on the first render of a cold load — which leaves the
   * frame pointed at the app root and showing "refused to connect" even after a
   * valid URL arrives. The template only renders the iframe once this is set.
   */
  safePreviewUrl = signal<SafeResourceUrl | null>(null);
  imageZoom = signal(1);
  isDraggingImage = signal(false);
  isGitSpace = computed(() => !!this.space()?.gitlabUrl);
  // A freshly-created document that has never been saved is editable even in a
  // git-backed space.
  isNewDocument = signal(false);
  /** The linked path has no document (and nothing moved away from it). */
  notFound = signal(false);
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
  /** My effective permission on the space allows writing files. */
  private canWriteFiles = computed(() => this.annotationPermission() !== 'VIEW');
  // HTML pages get their own contenteditable editor instead of the TipTap one:
  // it edits the file itself (head, scripts and all) rather than a Markdown
  // round-trip, so it stays available in git-backed spaces too.
  htmlEditMode = signal(false);
  canEditHtmlFile = computed(() =>
    this.isPreviewFile() &&
    this.previewType() === 'html' &&
    !this.htmlEditMode() &&
    this.canWriteFiles()
  );

  // Read/edit split: documents open in rendered read mode; the user clicks Edit
  // to switch to the TipTap editor.
  editMode = signal(false);
  /**
   * Content hash to resolve comment anchors against — only while showing saved
   * content. In edit mode it is deliberately null: the document on screen is a
   * draft that may never be saved, and caching anchors against it would point
   * every other reader at text that does not exist.
   */
  anchorDocHash = computed(() => this.editMode() ? null : (this.document()?.contentHash ?? null));
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
    protected caps: CapabilitiesService,
    private pdfExportService: PdfExportService
  ) {
    // Every space autosaves, so what the editor shows is what the API — and any
    // MCP client reading the space — gets back. Git-backed spaces autosave
    // *without* committing; the commit is the explicit Save/Done action, because
    // committing here would push one commit per typing pause.
    this.autoSave$.pipe(
      debounceTime(2000),
      takeUntil(this.destroy$)
    ).subscribe(() => this.saveDocument(false, true));

    // Render Mermaid + draw.io diagrams after the read-only HTML is flushed to the DOM.
    effect(() => {
      this.readonlyHtml();
      setTimeout(() => {
        this.markdownService.runMermaid(this.readonlyElement?.nativeElement);
        this.markdownService.runDrawio(this.readonlyElement?.nativeElement);
        this.markdownService.runImageLightbox(this.readonlyElement?.nativeElement);
        this.extractOutline();
      }, 0);
    });

    // The outline rail lives in the gap next to the paper — re-check the fit
    // whenever the paper width setting changes.
    effect(() => {
      this.contentWidthPx();
      setTimeout(() => this.updateOutlineFit());
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

  @HostListener('window:resize')
  onWindowResize(): void {
    this.updateOutlineFit();
  }

  /** Collect H1/H2 of the rendered read view for the outline rail. */
  private extractOutline(): void {
    const host = this.readonlyElement?.nativeElement;
    if (!host) {
      this.docOutline.set([]);
      return;
    }
    const items = Array.from(host.querySelectorAll<HTMLElement>('h1, h2'))
      .map(el => ({ text: el.textContent?.trim() ?? '', level: (el.tagName === 'H1' ? 1 : 2) as 1 | 2, el }))
      .filter(item => item.text);
    // A single heading is not worth a navigation.
    this.docOutline.set(items.length >= 2 ? items : []);
    this.activeOutlineIndex.set(0);
    this.updateOutlineFit();
  }

  /** The rail needs ~250px in the gap left of the centered paper. */
  private updateOutlineFit(): void {
    const container = this.scrollContainer?.nativeElement;
    if (!container) return;
    this.outlineFits.set((container.clientWidth - this.contentWidthPx()) / 2 >= 252);
  }

  scrollToHeading(item: OutlineItem, index: number): void {
    this.activeOutlineIndex.set(index);
    item.el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  /** Scroll-spy: highlight the outline entry whose section is at the top. */
  onContentScroll(): void {
    const items = this.docOutline();
    const container = this.scrollContainer?.nativeElement;
    if (!items.length || !container) return;
    const containerTop = container.getBoundingClientRect().top;
    let active = 0;
    for (let i = 0; i < items.length; i++) {
      if (items[i].el.getBoundingClientRect().top - containerTop <= 90) active = i;
      else break;
    }
    if (this.activeOutlineIndex() !== active) this.activeOutlineIndex.set(active);
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

  /** Switch the HTML preview into the contenteditable editor. */
  startHtmlEdit(): void {
    this.closeActionMenus();
    this.showHistoryPanel.set(false);
    this.htmlEditMode.set(true);
  }

  /**
   * A save in the HTML editor wrote a new version. The preview iframe would
   * otherwise re-serve the response it already has, so it gets a fresh URL.
   */
  onHtmlSaved(): void {
    this.refreshPreview(true);
    this.loadHistoryMeta();
  }

  /**
   * Point the preview at the live file. [cacheBust] adds a fresh query so a
   * frame that just saved does not re-serve the response it already has.
   */
  private refreshPreview(cacheBust = false): void {
    const space = this.space();
    if (!space || !this.documentPath) return;
    const url = `/api/spaces/${space.id}/files/${this.documentPath}` + (cacheBust ? `?v=${Date.now()}` : '');
    this.setPreviewUrl(url);
  }

  private setPreviewUrl(url: string): void {
    this.previewUrl.set(url);
    this.safePreviewUrl.set(this.sanitizer.bypassSecurityTrustResourceUrl(url));
  }

  /**
   * Route-guard hook (see unsavedChangesGuard): the HTML editor and the
   * spreadsheet grid both keep unsaved edits in the browser only, so navigating
   * away has to be confirmed rather than quietly discarding them.
   */
  confirmLeave(): boolean | Observable<boolean> {
    if (this.htmlEditor) return this.htmlEditor.confirmLeave();
    if (!this.sheetDirty()) return true;

    this.sheetLeaveAnswer?.next(false);
    const answer = new Subject<boolean>();
    this.sheetLeaveAnswer = answer;
    this.confirmSheetLeave.set(true);
    return answer.asObservable();
  }

  /** Resolves the leave prompt; true discards the edits and lets navigation run. */
  answerSheetLeave(leave: boolean): void {
    this.confirmSheetLeave.set(false);
    this.sheetLeaveAnswer?.next(leave);
    this.sheetLeaveAnswer?.complete();
    this.sheetLeaveAnswer = undefined;
    if (leave) {
      this.xlsxEdits.clear();
      this.sheetDirty.set(false);
    }
  }

  /**
   * The path the document had at a given version. History follows renames, so a
   * version from before a move lives under its old path — reading it under the
   * current one would find nothing.
   */
  private pathAt(version: DocumentVersion): string {
    return version.path || this.documentPath;
  }

  /** Material glyph for a file, so the download card is not a generic sheet of paper. */
  fileGlyph(path: string): string {
    return getFileIconGlyph(path);
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

  /** Creator + last editor for the topbar; null when the document has no git track yet. */
  private loadHistoryMeta(): void {
    const space = this.space();
    if (!space || !this.documentPath) return;
    this.documentHistoryService.getMeta(space.id, this.documentPath)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (meta) => this.historyMeta.set(meta.created ? meta : null),
        error: () => this.historyMeta.set(null)
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

    // A rendered file shows its old self in the preview frame rather than
    // through the markdown pipeline — the backend serves that version with the
    // same base tag the live file gets, so the page renders as it did.
    if (this.isPreviewFile()) {
      if (!this.canViewVersions()) return;
      this.setPreviewUrl(
        `/api/spaces/${space.id}/document-history/raw` +
        `?path=${encodeURIComponent(this.pathAt(version))}&sha=${encodeURIComponent(version.sha)}`
      );
      this.viewingVersion.set(version);
      this.historyViewMode.set('doc');
      return;
    }

    this.versionLoadingSha.set(version.sha);
    this.documentHistoryService.getVersionContent(space.id, this.pathAt(version), version.sha)
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
    this.documentHistoryService.getVersionDiff(space.id, this.pathAt(version), version.sha)
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
    if (this.isPreviewFile()) {
      this.refreshPreview();
      return;
    }
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
          this.historyViewMode.set('doc');
          this.diffLines.set([]);
          this.toastService.success('Version restored', 'The document was restored — the previous state stays available in the history.');
          if (this.isPreviewFile()) {
            this.refreshPreview(true);
            this.loadHistoryMeta();
          } else {
            this.loadDocument();
          }
          this.loadHistory();
        },
        error: () => {
          this.restoring.set(false);
          this.toastService.error('Restore failed', 'Could not restore this version. Please try again.');
        }
      });
  }

  /**
   * Whether a past version can be shown in place. A markdown document renders
   * through its own pipeline; among the files that are previewed rather than
   * edited, only HTML can be rendered back — an image or PDF version is a
   * binary the time capsule has no way to display.
   */
  canViewVersions(): boolean {
    return !this.isPreviewFile() || this.previewType() === 'html';
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
        this.treeSync.notify(space.id);
        this.router.navigate(['..'], { relativeTo: this.route });
      },
      error: (error) => {
        this.deleting.set(false);
        this.showDeleteConfirm.set(false);
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

  /**
   * The document as HTML for export. Which view is on screen decides where it
   * comes from: the TipTap instance only exists while editing (`showEditor()`),
   * so in the read view it is null and asking it for HTML yields nothing —
   * which is how this export used to produce a blank sheet for anyone who had
   * not clicked Edit first. The read view keeps its rendered markup in
   * `readonlyElement`, and that is also the copy with Mermaid diagrams drawn
   * and image paths already resolved.
   */
  private exportBodyHtml(): string | null {
    if (this.showEditor() && this.editor) return this.editor.getHTML();
    const readonly = this.readonlyElement?.nativeElement;
    if (readonly?.innerHTML.trim()) return readonly.innerHTML;
    // Neither view has content — the document is still loading, or failed to.
    return null;
  }

  exportAsPdf(): void {
    const title = this.documentTitle || this.documentPath.split('/').pop() || 'Document';

    // A configured renderer gives back a real file. Everything else — an
    // install without one, a renderer that is down — falls through to the
    // browser's print dialog, so the menu entry always does something.
    if (this.caps.pdfRenderer() && !this.isPreviewFile()) {
      const html = this.exportBodyHtml();
      if (html === null) {
        this.toastService.error('Export failed', 'There is nothing to export yet.');
        return;
      }
      this.exportingPdf.set(true);
      this.pdfExportService.render(this.printableDocument(title, html), title).subscribe({
        next: (pdf) => {
          this.exportingPdf.set(false);
          this.pdfExportService.save(pdf, title);
        },
        error: () => {
          this.exportingPdf.set(false);
          this.toastService.info('Falling back to print', 'The PDF service is unavailable.');
          this.printAsPdf(title);
        }
      });
      return;
    }

    this.printAsPdf(title);
  }

  /** True while the server is rendering, so the menu entry can say so. */
  exportingPdf = signal(false);

  /**
   * The standalone HTML that becomes the PDF, whether it is rendered on the
   * server or run through the browser's print dialog. One source for both, so
   * a change to the styling cannot land in one output and miss the other.
   */
  private printableDocument(title: string, bodyContent: string, forPrint = false): string {
    return `<!DOCTYPE html>
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
  ul[data-type="taskList"] li::before { content: "\u2610"; }
  ul[data-type="taskList"] li[data-checked="true"]::before { content: "\u2611"; }
  a { color: #2563eb; }
  ${forPrint ? '@media print { body { padding: 0; } }' : '@page { margin: 18mm 16mm; } body { padding: 0; max-width: none; }'}
</style>
</head><body>${bodyContent}</body></html>`;
  }

  private printAsPdf(title: string): void {

    let bodyContent = '';
    if (this.isPreviewFile()) {
      if (this.previewType() === 'image') {
        bodyContent = `<img src="${window.location.origin}${this.previewUrl()}" style="max-width:100%;height:auto;" />`;
      } else {
        bodyContent = `<iframe src="${window.location.origin}${this.previewUrl()}" style="width:100%;height:100vh;border:none;"></iframe>`;
      }
    } else {
      const html = this.exportBodyHtml();
      if (html === null) {
        // Better a plain refusal than a print dialog over an empty sheet, which
        // reads as "the export is broken" and costs a trip to the printer.
        this.toastService.error('Export failed', 'There is nothing to export yet.');
        return;
      }
      bodyContent = `<h1>${this.escapeHtml(title)}</h1>${html}`;
    }

    const printWindow = window.open('', '_blank');
    if (!printWindow) {
      this.toastService.error('Export failed', 'The browser blocked the print window.');
      return;
    }

    printWindow.document.write(this.printableDocument(title, bodyContent, true));
    printWindow.document.close();

    // document.write() often finishes before this line runs, so waiting for
    // `onload` alone can mean waiting forever. Check the state first, and give
    // images a chance to arrive — printing before they load prints gaps.
    const print = (): void => {
      const images = Array.from(printWindow.document.images);
      const pending = images.filter(img => !img.complete);
      let left = pending.length;
      const go = (): void => { printWindow.focus(); printWindow.print(); };
      if (!left) { go(); return; }
      const done = (): void => { if (--left === 0) go(); };
      pending.forEach(img => { img.addEventListener('load', done); img.addEventListener('error', done); });
      // A stuck image must not hold the export hostage.
      setTimeout(() => { if (left > 0) { left = 0; go(); } }, 3000);
    };
    if (printWindow.document.readyState === 'complete') print();
    else printWindow.addEventListener('load', print);
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

  /** Opens the assistant with a new conversation about the current document. */
  openAiChat(): void {
    const space = this.space();
    if (!space) return;
    this.router.navigate(['/ask'], { queryParams: { space: space.id, doc: this.documentPath } });
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
          // Another file — the HTML editor belongs to the one we just left.
          this.htmlEditMode.set(false);
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
        } else if (EditorComponent.VIDEO_EXTENSIONS.has(ext) || EditorComponent.AUDIO_EXTENSIONS.has(ext)) {
          this.isPreviewFile.set(true);
          this.previewType.set(EditorComponent.VIDEO_EXTENSIONS.has(ext) ? 'video' : 'audio');
          this.loading.set(false);
          const space = this.space();
          if (space) {
            this.previewUrl.set(`/api/spaces/${space.id}/files/${path}`);
          }
        } else if (ext === 'drawio') {
          this.isPreviewFile.set(true);
          this.previewType.set('drawio');
          this.loading.set(false);
          const space = this.space();
          if (space) {
            this.previewUrl.set(`/api/spaces/${space.id}/files/${path}`);
          }
        } else if (isUnrenderable(path)) {
          // No viewer for this one. Without this branch it fell through to the
          // text editor and opened a blank "Untitled" page, which reads as if
          // the file were missing.
          this.isPreviewFile.set(true);
          this.previewType.set('download');
          this.loading.set(false);
          const space = this.space();
          if (space) {
            this.previewUrl.set(`/api/spaces/${space.id}/files/${path}`);
          }
        } else if (EditorComponent.SPREADSHEET_EXTENSIONS.has(ext)) {
          this.isPreviewFile.set(true);
          this.previewType.set('spreadsheet');
          this.sheets.set([]);
          this.activeSheetIndex.set(0);
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
        // A previewed file never goes through loadDocument(), so who created and
        // last edited it — and whether it moved — has to be handled on this path.
        if (this.isPreviewFile()) {
          if (pathChanged) {
            this.viewingVersion.set(null);
            this.historyViewMode.set('doc');
            this.diffLines.set([]);
            this.historyMeta.set(null);
            this.showHistoryPanel.set(false);
          }
          this.initPreviewFile();
        }
      } else {
        // New document — remember the folder the user created it from so it
        // lands there instead of the default docs/ directory.
        this.newDocFolder = (params.get('folder') ?? '').replace(/^\/+|\/+$/g, '');
        this.isPreviewFile.set(false);
        this.notFound.set(false);
        this.initializeNewDocument();
      }
    });
  }

  ngOnDestroy(): void {
    this.flushPendingCommit();
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
          this.initPreviewFile();
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
    this.notFound.set(false);
    this.translationLang.set(null);
    this.availableLangs.set([]);
    this.viewingVersion.set(null);
    this.historyMeta.set(null);
    this.loadHistoryMeta();
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
          // The title was set in code, which fires no input event — measure it
          // here or a wrapping title opens clipped to one line.
          this.titleAutosize?.resize();
          // Apply a translation requested via ?lang= now that the original is rendered.
          const lang = this.pendingLang;
          this.pendingLang = null;
          if (lang) this.translateTo(lang);
        });
      },
      error: () => {
        // Nothing at this path — but it may have been moved rather than deleted,
        // in which case an old link should land on the document. Otherwise the
        // link is simply wrong: say so instead of opening a blank "Untitled"
        // editor, which reads as if the document existed and were empty.
        this.forwardToMovedDocument(space.id, this.documentPath, () => this.showNotFound());
      }
    });
  }

  /**
   * Follows a link whose document has since been renamed or moved.
   *
   * The endpoint answers 204 unless the path really is vacated and something was
   * moved out of it, so this is safe to ask speculatively — [onNotMoved] runs
   * when there is nowhere to go.
   */
  private forwardToMovedDocument(spaceId: string, path: string, onNotMoved: () => void): void {
    this.documentsService.resolveMoved(spaceId, path)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (moved) => {
          // The answer can arrive after the user has moved on to another file;
          // forwarding then would yank them out of what they are reading.
          if (this.documentPath !== path) return;
          if (!moved) {
            onNotMoved();
            return;
          }

          const inSpace = moved.sameSpace ? '' : ` in ${moved.spaceName}`;
          this.toastService.info(
            'This document moved',
            `It now lives at ${moved.path}${inSpace}. Taking you there.`
          );
          // Landing in another space changes the route's space segments *and*
          // the path, and the path arrives first. Dropping the loaded space
          // keeps the editor from fetching the new path out of the old space —
          // a guaranteed 404 that would flash the blank new-document editor.
          if (!moved.sameSpace) this.space.set(null);
          this.router.navigate(spaceRoute(moved.spaceFullPath, 'doc'), {
            queryParams: { path: moved.path },
            replaceUrl: true
          });
        },
        error: () => {
          if (this.documentPath === path) onNotMoved();
        }
      });
  }

  /**
   * What a previewed file (HTML, PDF, image, drawio, spreadsheet) needs once its
   * URL is set. Unlike a markdown document these are handed straight to an
   * `<iframe>`/`<img>`, which reports no HTTP status — a moved file would just
   * render the backend's 404 body with no way to notice. So the move is asked
   * about up front rather than in response to a failure, and a file that is
   * simply still there is left alone.
   */
  private initPreviewFile(): void {
    this.loadHistoryMeta();
    const space = this.space();
    if (space && this.documentPath) {
      this.forwardToMovedDocument(space.id, this.documentPath, () => {});
    }
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

  private showNotFound(): void {
    this.document.set(null);
    this.isNewDocument.set(false);
    this.editMode.set(false);
    this.markdownContent.set('');
    this.documentTitle = '';
    this.loading.set(false);
    this.notFound.set(true);
  }

  /** Folder of the missing path, offered as the place to create a new document. */
  notFoundFolder(): string {
    const idx = this.documentPath.lastIndexOf('/');
    return idx > 0 ? this.documentPath.substring(0, idx) : '';
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
    // Remember the passage on screen before the read view is torn down —
    // dropping someone at the top of a long document to edit a paragraph
    // halfway down means finding their place again by hand.
    const place = this.captureReadingPosition();
    this.editMode.set(true);
    setTimeout(() => {
      this.initTiptap(this.markdownContent());
      this.restoreReadingPosition(place, () => this.editorElement?.nativeElement);
    });
  }

  /** Where the reader is in whichever view is currently rendered. */
  private captureReadingPosition(): ScrollAnchor | null {
    const container = this.scrollContainer?.nativeElement;
    const content = this.showEditor()
      ? this.editorElement?.nativeElement
      : this.readonlyElement?.nativeElement;
    if (!container || !content) return null;
    return captureScrollAnchor(container, content);
  }

  /**
   * Put the reader back on the same passage once the other view has rendered.
   * Deferred a frame past the initial paint because both views settle late —
   * TipTap builds its document asynchronously, and the read view is still
   * running Mermaid and draw.io.
   */
  private restoreReadingPosition(
    place: ScrollAnchor | null,
    content: () => HTMLElement | undefined
  ): void {
    if (!place) return;
    const apply = () => {
      const container = this.scrollContainer?.nativeElement;
      const el = content();
      if (container && el) restoreScrollAnchor(container, el, place);
    };
    requestAnimationFrame(apply);
    // Late-rendering content (diagrams, highlighted code) changes the height
    // after the first pass, so correct once more when it has settled.
    setTimeout(apply, 250);
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
        // bookFiles exposes the archive's entries, which is how the editability
        // guard sees parts we would drop. cellStyles keeps number formats.
        const wb = XLSX.read(new Uint8Array(buffer), {
          type: 'array', cellStyles: true, bookFiles: true
        });
        const sheets: SheetView[] = wb.SheetNames.map((name: string) =>
          this.readSheet(XLSX, wb.Sheets[name], name)
        );
        // Guard against a race where the user navigated to another file mid-fetch.
        if (this.documentPath !== path) return;

        this.xlsxWorkbook = wb;
        this.xlsxEdits.clear();
        this.sheetDirty.set(false);
        this.sheetEditMode.set(false);
        const blocked = this.unsupportedForEditing(wb);
        this.xlsxBlockedReason.set(blocked);
        this.xlsxEditable.set(blocked === null);

        this.sheets.set(sheets);
        this.activeSheetIndex.set(0);
        this.loading.set(false);
      })
      .catch(() => {
        if (this.documentPath !== path) return;
        this.spreadsheetError.set('This spreadsheet could not be read.');
        this.loading.set(false);
      });
  }

  startSheetEdit(): void {
    if (!this.canEditSpreadsheet()) return;
    this.sheetEditMode.set(true);
  }

  cancelSheetEdit(): void {
    this.sheetEditMode.set(false);
    if (!this.sheetDirty()) return;
    // Edits live only in the grid and the pending map, so re-reading the file is
    // the cheapest way to be certain nothing half-applied survives.
    this.xlsxEdits.clear();
    this.sheetDirty.set(false);
    this.loadSpreadsheet();
  }

  /** A cell was typed into: update the grid and remember the edit for the save. */
  onCellEdit(rowIndex: number, colIndex: number, event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    const sheetIndex = this.activeSheetIndex();
    const sheets = this.sheets();
    const sheet = sheets[sheetIndex];
    if (!sheet) return;
    if (sheet.rows[rowIndex]?.[colIndex] === value) return;

    // Signals holding arrays don't re-emit on in-place mutation, so the row is
    // replaced rather than written through.
    const rows = sheet.rows.map((r, i) =>
      i === rowIndex ? r.map((c, j) => (j === colIndex ? value : c)) : r
    );
    this.sheets.set(sheets.map((s, i) => (i === sheetIndex ? { ...s, rows } : s)));
    this.xlsxEdits.set(`${sheetIndex}:${rowIndex}:${colIndex}`, value);
    this.sheetDirty.set(true);
  }

  /**
   * Writes the edited cells into the parsed workbook and saves the whole file
   * back through the upload endpoint, which replaces the bytes at this path and
   * commits — the ordinary document save path only carries text.
   */
  saveSpreadsheet(): void {
    const space = this.space();
    const wb = this.xlsxWorkbook;
    if (!space || !wb || this.savingSheet() || !this.sheetDirty()) return;

    this.savingSheet.set(true);
    const path = this.documentPath;

    this.loadXlsxLib()
      .then((XLSX: any) => {
        this.applyEdits(XLSX, wb);
        const out: ArrayBuffer = XLSX.write(wb, {
          bookType: 'xlsx', type: 'array', cellStyles: true
        });
        const name = path.split('/').pop() || 'sheet.xlsx';
        const file = new File([out], name, {
          type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        });
        // uploadFiles reports progress events, so the upload is only finished
        // when the stream completes — the first event is merely "sent".
        return lastValueFrom(
          this.documentsService.uploadFiles(space.id, [{ file, relativePath: path }], {
            commit: true,
            commitMessage: `Edit ${path}`
          })
        );
      })
      .then(() => {
        this.savingSheet.set(false);
        this.xlsxEdits.clear();
        this.sheetDirty.set(false);
        this.toastService.success('Spreadsheet saved', 'Your changes were written and committed.');
        // The topbar's last-editor line is now stale.
        this.loadHistoryMeta();
      })
      .catch(() => {
        this.savingSheet.set(false);
        this.toastService.error('Save failed', 'The spreadsheet could not be saved. Please try again.');
      });
  }

  /** Puts each pending edit into its cell, keeping the rest of the model intact. */
  private applyEdits(XLSX: any, wb: any): void {
    const sheets = this.sheets();
    for (const [key, raw] of this.xlsxEdits) {
      const [sheetIndex, rowIndex, colIndex] = key.split(':').map(Number);
      const sheet = sheets[sheetIndex];
      const ws = wb.Sheets[wb.SheetNames[sheetIndex]];
      if (!sheet || !ws) continue;

      const address = XLSX.utils.encode_cell({
        r: sheet.origin.r + rowIndex,
        c: sheet.origin.c + colIndex
      });
      const previous = ws[address];
      const value = raw.trim();

      if (value === '') {
        delete ws[address];
        continue;
      }

      // A typed literal replaces whatever was there, formula included — the UI
      // marks formula cells so that is a deliberate act rather than a surprise.
      const asNumber = Number(value);
      const isNumeric = value !== '' && Number.isFinite(asNumber);
      const cell: any = isNumeric ? { t: 'n', v: asNumber } : { t: 's', v: raw };
      // Keep the cell's number format so an edited figure still displays as one.
      if (previous?.z) cell.z = previous.z;
      ws[address] = cell;
    }
  }

  /** One sheet's grid, walked over its declared range so indices map to addresses. */
  private readSheet(XLSX: any, ws: any, name: string): SheetView {
    const ref = ws?.['!ref'];
    if (!ref) return { name, rows: [], formulaAt: [], origin: { r: 0, c: 0 } };

    const range = XLSX.utils.decode_range(ref);
    const rows: string[][] = [];
    const formulaAt: boolean[][] = [];
    for (let r = range.s.r; r <= range.e.r; r++) {
      const row: string[] = [];
      const formulaRow: boolean[] = [];
      for (let c = range.s.c; c <= range.e.c; c++) {
        const cell = ws[XLSX.utils.encode_cell({ r, c })];
        // `w` is the formatted text Excel would show; fall back to the raw value.
        row.push(cell ? (cell.w ?? (cell.v === undefined || cell.v === null ? '' : String(cell.v))) : '');
        formulaRow.push(!!cell?.f);
      }
      rows.push(row);
      formulaAt.push(formulaRow);
    }
    return { name, rows, formulaAt, origin: { r: range.s.r, c: range.s.c } };
  }

  /**
   * Parts of a workbook this editor cannot round-trip, by archive entry.
   *
   * SheetJS does not model charts, pivot tables, drawings or embedded images, so
   * they are absent from the object we write back — a save would drop them
   * without a word. Refusing to edit is the honest outcome: the alternative is
   * silently returning someone a gutted workbook.
   */
  private unsupportedForEditing(wb: any): string | null {
    const entries: string[] = wb?.keys ?? Object.keys(wb?.files ?? {});
    if (!entries.length) return null;

    const found = [
      { prefix: 'xl/charts/', label: 'charts' },
      { prefix: 'xl/pivotTables/', label: 'pivot tables' },
      { prefix: 'xl/drawings/', label: 'drawings' },
      { prefix: 'xl/media/', label: 'images' },
    ].filter(part => entries.some(e => e.startsWith(part.prefix))).map(part => part.label);

    if (!found.length) return null;
    const list = found.length === 1
      ? found[0]
      : `${found.slice(0, -1).join(', ')} and ${found[found.length - 1]}`;
    return `This workbook contains ${list}, which editing here would remove. Open it in Excel to change it.`;
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
      // merge, not replace: a bare queryParams drops every other param — notably
      // ?lang=, so following a link while reading a translation fell back to the
      // original language.
      this.router.navigate([], {
        relativeTo: this.route,
        queryParams: { path: filePath },
        queryParamsHandling: 'merge',
      });
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
        if (!this.isReadOnly()) this.markDirty();
      }
    });

    // Snapshot for the minimal-diff save: the loaded markdown and what the
    // serializer emits for this document before any user edit.
    this.editSessionOriginal = content;
    this.editSessionBaseline = this.editorMarkdown();
  }

  /** Mark the document as having unpersisted edits and arm the autosave. */
  private markDirty(): void {
    this.hasChanges.set(true);
    this.lastSaved.set(false);
    this.autoSave$.next();
  }

  /**
   * The title lives outside the TipTap editor, so its edits don't reach
   * onUpdate. Without this a title-only rename never marks the document dirty:
   * Done takes the nothing-changed path, no request goes out, and the new title
   * survives only until the next reload.
   */
  onTitleChanged(): void {
    if (!this.showEditor()) return;
    this.markDirty();
  }

  /**
   * Finish editing: persist any unsaved changes (returning to read mode on
   * success) or, when nothing is dirty, drop straight back to read mode.
   * Also the point where a git-backed space turns its autosaved content into a
   * commit — autosave deliberately leaves that to this button.
   */
  doneEditing(): void {
    if (this.saving()) return;
    if (this.hasChanges() || this.pendingCommit()) {
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

  /**
   * Title as it gets persisted: collapsed to a single line. The field wraps but
   * still holds one logical line, and a pasted heading can carry newlines that
   * would split the "# Title" line into stray markdown.
   */
  private cleanTitle(): string {
    return (this.documentTitle || '').replace(/\s+/g, ' ').trim();
  }

  /**
   * Re-attach the load-time "# Title" line, following a title rename.
   *
   * A document being created has no such line yet, so it gets one written in.
   * Without it the title lived only in the database: the markdown file opened
   * headingless everywhere outside DocuVault, and a page that had been named but
   * not yet written serialized to an empty string, which the backend rejects
   * outright. [body] never carries the heading itself, so re-prepending it on
   * every later save cannot double it up.
   */
  private withTitleHeading(body: string): string {
    const currentTitle = this.cleanTitle();
    if (!this.strippedH1) {
      if (!this.isNewDocument() || !currentTitle) return body;
      return body.trim() ? `# ${currentTitle}\n\n${body}` : `# ${currentTitle}\n`;
    }
    const originalTitle = this.strippedH1.match(/^#\s+(.+)/)?.[1]?.trim();
    if (!currentTitle || originalTitle === currentTitle) return this.strippedH1 + body;
    const newlines = this.strippedH1.substring(this.strippedH1.indexOf('\n'));
    return `# ${currentTitle}${newlines}${body}`;
  }

  /** After a successful save the persisted state becomes the new diff base. */
  private rebaseEditSession(body: string, raw: string): void {
    this.editSessionOriginal = body;
    this.editSessionBaseline = raw;
  }

  saveDocument(returnToRead = false, autosave = false): void {
    const space = this.space();
    if (!space || !this.editor) return;
    if (this.saving()) {
      // A save is already in flight. Re-arm instead of dropping this round —
      // otherwise edits typed during the request are never sent.
      if (autosave) this.autoSave$.next();
      return;
    }

    const { body, content, raw } = this.serializeForSave();

    // Nothing typed anywhere: the backend refuses blank content, so asking it
    // only produces a storage error for something a single word would fix.
    if (!content.trim()) {
      if (!autosave) this.toastService.error(NOTHING_TO_SAVE.title, NOTHING_TO_SAVE.message);
      return;
    }

    this.saving.set(true);

    const isGit = this.isGitSpace();
    // An autosave into a git-backed space writes the working tree only. Anything
    // else commits — for spaces without a remote the backend commits regardless.
    const commit = isGit && !autosave;

    const onSaved = () => {
      this.saving.set(false);
      this.saveErrorNotified = false;
      this.lastPersistedContent = content;
      this.pendingCommit.set(isGit && autosave);
      this.rebaseEditSession(body, raw);
      // Keep the read-view base in sync — without this, leaving the editor
      // after an autosave (Done with no pending changes) shows stale content.
      this.markdownContent.set(body);
      // This request only covers what was serialized before it went out. Anything
      // typed since stays dirty and re-arms, instead of reading as saved.
      const dirty = this.editorMarkdown() !== raw;
      this.hasChanges.set(dirty);
      this.lastSaved.set(!dirty);
      if (dirty) this.autoSave$.next();
      // An autosave produces no commit, so there is no new history entry to load.
      if (!autosave) {
        if (this.showHistoryPanel()) this.loadHistory();
        this.loadHistoryMeta();
      }
      if (returnToRead) this.exitToReadView(body);
    };

    const title = this.cleanTitle();

    if (this.documentPath) {
      // Update existing document
      this.documentsService.updateDocument(space.id, this.documentPath, {
        title,
        content,
        autoCommit: commit,
        commitMessage: commit ? `Update ${title || this.documentPath}` : undefined
      }).subscribe({
        next: (doc) => {
          this.document.set(doc);
          onSaved();
        },
        error: (err) => this.handleSaveError(err)
      });
    } else {
      // Create new document
      const path = this.generatePath();
      this.documentsService.createDocument(space.id, {
        path,
        title,
        content,
        autoCommit: commit,
        commitMessage: commit ? `Add ${title || path}` : undefined
      }).subscribe({
        next: (doc) => {
          this.document.set(doc);
          this.documentPath = path; this.documentPathSignal.set(path);
          this.treeSync.notify(space.id);
          onSaved();
        },
        error: (err) => this.handleSaveError(err)
      });
    }
  }

  /**
   * A failed save must not read as a successful one — at that point the browser
   * holds the only copy of the change. Keeps the document dirty so the next edit
   * retries, and reports once per failure streak instead of once per keystroke.
   */
  private handleSaveError(error: unknown): void {
    this.saving.set(false);
    this.hasChanges.set(true);
    this.lastSaved.set(false);
    if (this.saveErrorNotified) return;
    this.saveErrorNotified = true;
    const { title, message } = describeSaveError(error);
    this.toastService.error(title, message);
  }

  /**
   * Commits content that was autosaved but never confirmed with Save/Done, so a
   * git-backed space does not leave the edit sitting uncommitted in its working
   * tree. Fire-and-forget: the content itself is already persisted.
   */
  private flushPendingCommit(): void {
    const space = this.space();
    const content = this.lastPersistedContent;
    if (!this.pendingCommit() || !space || !this.documentPath || content === null) return;
    this.pendingCommit.set(false);
    this.documentsService.updateDocument(space.id, this.documentPath, {
      title: this.documentTitle,
      content,
      autoCommit: true,
      commitMessage: `Update ${this.documentTitle || this.documentPath}`
    }).subscribe({ error: () => {} });
  }

  /** Tear down the editor and drop back to the rendered read view after a save. */
  private exitToReadView(content: string): void {
    // Same courtesy on the way back: saving a paragraph shouldn't cost you
    // your place in the document either.
    const place = this.captureReadingPosition();
    this.markdownContent.set(content);
    this.editMode.set(false);
    setTimeout(() => {
      this.renderReadView(content);
      this.restoreReadingPosition(place, () => this.readonlyElement?.nativeElement);
    });
  }

  saveAndCommit(): void {
    const space = this.space();
    const user = this.authService.user();
    if (!space || !this.editor || !user) return;

    const { body, content, raw } = this.serializeForSave();

    if (!content.trim()) {
      this.toastService.error(NOTHING_TO_SAVE.title, NOTHING_TO_SAVE.message);
      return;
    }

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
        this.saveErrorNotified = false;
        this.lastPersistedContent = content;
        this.pendingCommit.set(false);
        this.rebaseEditSession(body, raw);
        this.markdownContent.set(body);
        if (this.showHistoryPanel()) this.loadHistory();
        this.loadHistoryMeta();
      },
      error: (err) => this.handleSaveError(err)
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
    this.documentsService.uploadFiles(space.id, [{ file: named, relativePath: named.name }], { folder })
      .pipe(filter((event): event is HttpResponse<UploadedFile[]> => event instanceof HttpResponse))
      .subscribe({
        next: (response) => {
          const path = response.body?.[0]?.path;
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
