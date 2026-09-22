import { Component, inject, input } from '@angular/core';
import { Attachment, AttachmentsService } from '../../core/api/attachments.service';
import { formatFileSize } from '../services/attachment-queue';

/** The files that went with a message: photos as thumbnails, other files as tiles. Each opens in a new tab. */
@Component({
  selector: 'app-message-attachments',
  standalone: true,
  template: `
    <div class="files">
      @for (file of attachments(); track file.id) {
        <a class="file" [class.image]="file.kind === 'IMAGE'" [href]="url(file)" target="_blank" rel="noopener" [title]="'Open ' + file.fileName">
          @if (file.kind === 'IMAGE') {
            <img [src]="url(file)" [alt]="file.fileName" loading="lazy" />
          } @else {
            <span translate="no" class="material-icons">{{ file.kind === 'PDF' ? 'picture_as_pdf' : 'description' }}</span>
            <span class="meta">
              <span class="name">{{ file.fileName }}</span>
              <span class="size">{{ size(file.sizeBytes) }}</span>
            </span>
          }
        </a>
      }
    </div>
  `,
  styles: [`
    .files {
      display: flex;
      flex-wrap: wrap;
      justify-content: flex-end;
      gap: 6px;
    }

    .file {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      max-width: 240px;
      padding: 8px 10px;
      border: 1px solid var(--border);
      border-radius: var(--radius-md);
      background: var(--surface);
      color: var(--text-primary);
      text-decoration: none;

      &:hover { border-color: var(--primary); }
      .material-icons { font-size: 22px; color: var(--primary-dark); }

      &.image {
        padding: 0;
        overflow: hidden;
        border-radius: var(--radius-lg);

        img {
          display: block;
          width: 132px;
          height: 132px;
          object-fit: cover;
        }
      }
    }

    .meta { display: flex; flex-direction: column; min-width: 0; }
    .name { font-size: 13px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .size { font-size: 11.5px; color: var(--text-muted); }
  `]
})
export class MessageAttachmentsComponent {
  private service = inject(AttachmentsService);

  attachments = input<Pick<Attachment, 'id' | 'fileName' | 'kind' | 'sizeBytes'>[]>([]);

  size = formatFileSize;

  url(file: { id: string }): string {
    return this.service.contentUrl(file.id);
  }
}
