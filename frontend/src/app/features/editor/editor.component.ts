import { Component, OnInit, OnDestroy, signal, computed, ViewChild, ElementRef, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
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
import { ToastService } from '../../shared/services/toast.service';
import { Subject, debounceTime, takeUntil } from 'rxjs';
import TurndownService from 'turndown';
import { marked } from 'marked';

@Component({
  selector: 'app-editor',
  standalone: true,
  imports: [CommonModule, FormsModule, ShareLinkDialogComponent],
  template: `
    <div class="h-full flex flex-col">
      @if (!isPreviewFile()) {
      <div class="editor-toolbar">
        @if (!isGitSpace()) {
          <!-- Editing toolbar for non-git spaces -->
          <div class="flex items-center gap-1">
            <button class="editor-icon-btn" [class.active]="isActive('bold')" (click)="toggleBold()" title="Bold"><b>B</b></button>
            <button class="editor-icon-btn" [class.active]="isActive('italic')" (click)="toggleItalic()" title="Italic"><i>I</i></button>
            <button class="editor-icon-btn" [class.active]="isActive('strike')" (click)="toggleStrike()" title="Strikethrough"><s>S</s></button>
            <button class="editor-icon-btn" [class.active]="isActive('code')" (click)="toggleCode()" title="Inline code">
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4"/></svg>
            </button>
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
          </div>
          <div class="flex items-center gap-2">
            @if (hasChanges()) {
              <span class="text-xs text-muted">{{ saving() ? 'Saving...' : 'Unsaved changes' }}</span>
            } @else if (lastSaved()) {
              <span class="text-xs text-muted">Saved</span>
            }
            <button class="btn-save" (click)="saveDocument()" [disabled]="saving() || !hasChanges()" title="Save">
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4"/></svg>
              Save
            </button>
          </div>
        } @else {
          <!-- Read-only banner for git spaces -->
          <div class="flex items-center gap-2">
            <span class="text-sm text-amber-600 font-medium">Read-only — synced from Git</span>
          </div>
        }
        <div class="flex items-center gap-2" [class.ml-auto]="isGitSpace()">
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
          }
        </div>
      </div>

      }

      @if (isPreviewFile()) {
        <!-- Preview topbar — fixed row, not scrollable -->
        <div class="preview-topbar">
          <div class="preview-filename">
            <span class="material-icons preview-file-icon">{{ previewType() === 'html' ? 'code' : 'image' }}</span>
            {{ documentPath.split('/').pop() }}
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
        <div class="flex-1 overflow-y-auto editor-bg">
          @if (previewType() === 'html') {
            <iframe [src]="safePreviewUrl()" class="preview-iframe" sandbox="allow-scripts allow-same-origin"></iframe>
          } @else {
            <div class="image-zoom-container" (wheel)="onImageWheel($event)">
              <img
                [src]="previewUrl()"
                [alt]="documentPath.split('/').pop()"
                class="preview-image"
                [style.width]="imageZoom() === 1 ? null : (imageZoom() * 100) + '%'"
              />
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
              <input
                type="text"
                [(ngModel)]="documentTitle"
                placeholder="Untitled"
                [readonly]="isGitSpace()"
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

    .image-zoom-container {
      overflow: auto;
      flex: 1;
      width: 100%;
      min-height: 0;
      display: flex;
      align-items: center;
    }

    .preview-image {
      width: 100%;
      height: auto;
      display: block;
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
  showDeleteConfirm = signal(false);
  deleting = signal(false);
  gitLinkCopied = signal(false);
  isPreviewFile = signal(false);
  previewType = signal<'image' | 'html'>('image');
  previewUrl = signal('');
  safePreviewUrl = signal<SafeResourceUrl>('');
  imageZoom = signal(1);
  isGitSpace = computed(() => !!this.space()?.gitlabUrl);

  zoomIn(): void { this.imageZoom.update(z => Math.min(z + 0.25, 4)); }
  zoomOut(): void { this.imageZoom.update(z => Math.max(z - 0.25, 0.25)); }
  resetZoom(): void { this.imageZoom.set(1); }
  onImageWheel(event: WheelEvent): void {
    event.preventDefault();
    if (event.deltaY < 0) this.zoomIn(); else this.zoomOut();
  }

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private spacesService: SpacesService,
    private documentsService: DocumentsService,
    private aiService: AiService,
    private gitService: GitService,
    private authService: AuthService,
    private sanitizer: DomSanitizer,
    private toastService: ToastService
  ) {
    this.autoSave$.pipe(
      debounceTime(2000),
      takeUntil(this.destroy$)
    ).subscribe(() => {
      if (!this.isGitSpace()) this.saveDocument();
    });
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

    this.editor = new Editor({
      element: el,
      editable: !this.isGitSpace(),
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
        if (!this.isGitSpace()) {
          this.hasChanges.set(true);
          this.lastSaved.set(false);
          this.autoSave$.next();
        }
      }
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
