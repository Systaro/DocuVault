import { Component, input, output } from '@angular/core';
import { PendingAttachment, formatFileSize } from '../services/attachment-queue';

/** Files waiting to go with a message: a thumbnail or file tile each, upload progress, and a remove button. */
@Component({
  selector: 'app-attachment-tray',
  standalone: true,
  template: `
    <ul class="tray" aria-label="Attached files">
      @for (item of items(); track item.localId) {
        <li class="chip" [class.error]="item.status === 'error'" [class.uploading]="item.status === 'uploading'" [title]="item.error || item.name">
          @if (item.previewUrl) {
            <img class="thumb" [src]="item.previewUrl" alt="" />
          } @else {
            <span class="thumb tile" [class.pdf]="item.kind === 'PDF'">
              <span translate="no" class="material-icons">{{ item.kind === 'PDF' ? 'picture_as_pdf' : 'description' }}</span>
            </span>
          }
          <span class="meta">
            <span class="name">{{ item.name }}</span>
            <span class="detail">
              @if (item.status === 'uploading') {
                {{ item.progress < 100 ? 'Uploading ' + item.progress + '%' : 'Processing' }}
              } @else if (item.status === 'error') {
                {{ item.error }}
              } @else {
                {{ item.note || size(item.size) }}
              }
            </span>
          </span>
          @if (item.status === 'uploading') {
            <span class="progress" aria-hidden="true"><span class="bar" [class]="'bar p' + tenth(item.progress)"></span></span>
          }
          <button type="button" class="remove" (click)="removed.emit(item.localId)" [attr.aria-label]="'Remove ' + item.name" title="Remove">
            <span translate="no" class="material-icons">close</span>
          </button>
        </li>
      }
    </ul>
  `,
  styles: [`
    .tray {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin: 0;
      padding: 0;
      list-style: none;
    }

    .chip {
      position: relative;
      display: flex;
      align-items: center;
      gap: 8px;
      max-width: 240px;
      padding: 5px 30px 5px 5px;
      overflow: hidden;
      border: 1px solid var(--border);
      border-radius: var(--radius-md);
      background: var(--surface);
      animation: chip-in 0.18s ease-out;

      &.error { border-color: var(--error); }
    }

    @keyframes chip-in { from { opacity: 0; transform: scale(0.94); } }

    .thumb {
      flex-shrink: 0;
      width: 38px;
      height: 38px;
      border-radius: 7px;
      object-fit: cover;
      background: var(--background-darker);
    }

    .tile {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      color: var(--primary-dark);

      &.pdf { color: #c2410c; background: color-mix(in srgb, #fb923c 16%, var(--surface)); }
      .material-icons { font-size: 22px; }
    }

    .meta { display: flex; flex-direction: column; min-width: 0; }
    .name { font-size: 12.5px; font-weight: 600; color: var(--text-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .detail { font-size: 11.5px; color: var(--text-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .error .detail { color: var(--error); }

    .progress {
      position: absolute;
      left: 0;
      right: 0;
      bottom: 0;
      height: 3px;
      background: var(--background-darker);
    }
    .bar {
      display: block;
      height: 100%;
      background: linear-gradient(90deg, var(--primary), #8b5cf6, #ec4899);
      transition: width 0.2s ease;
    }
    @for $i from 0 through 10 { .bar.p#{$i} { width: $i * 10%; } }

    .remove {
      position: absolute;
      top: 4px;
      right: 4px;
      display: inline-flex;
      padding: 2px;
      border: 0;
      border-radius: var(--radius-full);
      background: transparent;
      color: var(--text-muted);
      cursor: pointer;

      .material-icons { font-size: 16px; }
      &:hover { background: var(--background-darker); color: var(--text-primary); }
    }
  `]
})
export class AttachmentTrayComponent {
  items = input<PendingAttachment[]>([]);
  removed = output<string>();

  size = formatFileSize;

  /** Progress in steps of ten, so the bar width comes from a class rather than an inline style. */
  tenth(progress: number): number {
    return Math.max(0, Math.min(10, Math.round(progress / 10)));
  }
}
