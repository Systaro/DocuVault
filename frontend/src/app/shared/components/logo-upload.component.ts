import { Component, EventEmitter, Input, Output, signal } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-logo-upload',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div
      class="logo-upload-zone"
      [class.dragging]="dragging()"
      (dragover)="onDragOver($event)"
      (dragleave)="dragging.set(false)"
      (drop)="onDrop($event)"
      (click)="fileInput.click()"
    >
      <input
        #fileInput
        type="file"
        accept="image/png,image/jpeg,image/svg+xml,image/webp"
        (change)="onFileSelected($event)"
        hidden
      />

      @if (previewUrl() || currentLogoUrl) {
        <div class="logo-preview">
          <img [src]="previewUrl() || currentLogoUrl" alt="Logo" />
          <div class="logo-overlay">
            <span class="material-icons">edit</span>
            <span>Change logo</span>
          </div>
        </div>
      } @else {
        <div class="upload-placeholder">
          <span class="material-icons">add_photo_alternate</span>
          <span class="upload-text">Upload logo</span>
          <span class="upload-hint">PNG, JPG, SVG, WebP (max 2MB)</span>
        </div>
      }

      @if (uploading()) {
        <div class="upload-progress">
          <span class="material-icons animate-spin">sync</span>
        </div>
      }
    </div>

    @if (previewUrl() || currentLogoUrl) {
      <button
        type="button"
        class="remove-btn"
        (click)="removeLogo($event)"
      >
        <span class="material-icons">delete_outline</span>
        Remove logo
      </button>
    }

    @if (error()) {
      <div class="upload-error">{{ error() }}</div>
    }
  `,
  styles: [`
    :host {
      display: block;
    }

    .logo-upload-zone {
      width: 120px;
      height: 120px;
      border: 2px dashed var(--border);
      border-radius: var(--radius-lg);
      cursor: pointer;
      position: relative;
      overflow: hidden;
      transition: all var(--transition);

      &:hover {
        border-color: var(--primary);
      }

      &.dragging {
        border-color: var(--primary);
        background: rgba(111, 179, 184, 0.08);
      }
    }

    .upload-placeholder {
      width: 100%;
      height: 100%;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 4px;
      color: var(--text-muted);

      .material-icons {
        font-size: 32px;
        color: var(--primary-light);
      }

      .upload-text {
        font-size: 12px;
        font-weight: 500;
      }

      .upload-hint {
        font-size: 10px;
        text-align: center;
        padding: 0 8px;
      }
    }

    .logo-preview {
      width: 100%;
      height: 100%;
      position: relative;

      img {
        width: 100%;
        height: 100%;
        object-fit: cover;
      }

      .logo-overlay {
        position: absolute;
        inset: 0;
        background: rgba(0, 0, 0, 0.5);
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 4px;
        color: white;
        font-size: 12px;
        opacity: 0;
        transition: opacity var(--transition);

        .material-icons {
          font-size: 24px;
        }
      }

      &:hover .logo-overlay {
        opacity: 1;
      }
    }

    .upload-progress {
      position: absolute;
      inset: 0;
      background: rgba(255, 255, 255, 0.8);
      display: flex;
      align-items: center;
      justify-content: center;
      color: var(--primary);
    }

    .remove-btn {
      display: flex;
      align-items: center;
      gap: 4px;
      margin-top: 8px;
      background: none;
      border: none;
      color: var(--danger, #dc3545);
      font-size: 12px;
      cursor: pointer;
      padding: 0;

      .material-icons {
        font-size: 16px;
      }

      &:hover {
        text-decoration: underline;
      }
    }

    .upload-error {
      margin-top: 4px;
      font-size: 12px;
      color: var(--danger, #dc3545);
    }
  `]
})
export class LogoUploadComponent {
  @Input() currentLogoUrl: string | null = null;
  @Output() fileSelected = new EventEmitter<File>();
  @Output() logoRemoved = new EventEmitter<void>();

  dragging = signal(false);
  uploading = signal(false);
  previewUrl = signal<string | null>(null);
  error = signal<string | null>(null);

  private readonly maxSize = 2 * 1024 * 1024;
  private readonly allowedTypes = ['image/png', 'image/jpeg', 'image/svg+xml', 'image/webp'];

  onDragOver(event: DragEvent): void {
    event.preventDefault();
    this.dragging.set(true);
  }

  onDrop(event: DragEvent): void {
    event.preventDefault();
    this.dragging.set(false);
    const file = event.dataTransfer?.files[0];
    if (file) this.handleFile(file);
  }

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (file) this.handleFile(file);
    input.value = '';
  }

  private handleFile(file: File): void {
    this.error.set(null);

    if (!this.allowedTypes.includes(file.type)) {
      this.error.set('Invalid file type. Use PNG, JPG, SVG, or WebP.');
      return;
    }
    if (file.size > this.maxSize) {
      this.error.set('File too large. Maximum size is 2MB.');
      return;
    }

    const reader = new FileReader();
    reader.onload = () => this.previewUrl.set(reader.result as string);
    reader.readAsDataURL(file);

    this.fileSelected.emit(file);
  }

  removeLogo(event: Event): void {
    event.stopPropagation();
    this.previewUrl.set(null);
    this.logoRemoved.emit();
  }

  setUploading(value: boolean): void {
    this.uploading.set(value);
  }

  clearPreview(): void {
    this.previewUrl.set(null);
  }
}
