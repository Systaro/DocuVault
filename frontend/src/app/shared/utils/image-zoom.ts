import { signal } from '@angular/core';

export class ImageZoomHandler {
  readonly zoom = signal(1);
  readonly dragging = signal(false);

  private dragState: { x: number; y: number; scrollLeft: number; scrollTop: number; el: HTMLElement } | null = null;
  private boundDragMove = this.onDragMove.bind(this);
  private boundDragEnd = this.onDragEnd.bind(this);

  zoomIn(): void { this.zoom.update(z => Math.min(z + 0.25, 4)); }
  zoomOut(): void { this.zoom.update(z => Math.max(z - 0.25, 0.25)); }
  reset(): void { this.zoom.set(1); }

  onDragStart(event: MouseEvent): void {
    if (event.button !== 0) return;
    const el = event.currentTarget as HTMLElement;
    event.preventDefault();
    this.dragging.set(true);
    this.dragState = { x: event.clientX, y: event.clientY, scrollLeft: el.scrollLeft, scrollTop: el.scrollTop, el };
    document.addEventListener('mousemove', this.boundDragMove);
    document.addEventListener('mouseup', this.boundDragEnd);
  }

  private onDragMove(event: MouseEvent): void {
    if (!this.dragState) return;
    const { el, x, y, scrollLeft, scrollTop } = this.dragState;
    if (el.scrollWidth > el.clientWidth) el.scrollLeft = scrollLeft - (event.clientX - x);
    if (el.scrollHeight > el.clientHeight) el.scrollTop = scrollTop - (event.clientY - y);
  }

  private onDragEnd(): void {
    this.dragging.set(false);
    this.dragState = null;
    document.removeEventListener('mousemove', this.boundDragMove);
    document.removeEventListener('mouseup', this.boundDragEnd);
  }

  destroy(): void {
    document.removeEventListener('mousemove', this.boundDragMove);
    document.removeEventListener('mouseup', this.boundDragEnd);
  }
}
