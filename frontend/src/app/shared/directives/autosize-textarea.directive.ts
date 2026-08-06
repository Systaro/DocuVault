import { Directive, ElementRef, OnDestroy, AfterViewInit, HostListener, inject } from '@angular/core';

/**
 * Grows a textarea to fit its content instead of scrolling it.
 *
 * Used where a field has to accept one logical line that may still wrap over
 * several visual ones — a document title being the case in point: an <input>
 * would clip the overflow silently, showing no sign that the value continues.
 *
 * Re-measures on input and whenever the element's own width changes, so
 * resizing the window or the editor's paper width reflows the wrap correctly.
 */
@Directive({
  selector: 'textarea[appAutosize]',
  standalone: true
})
export class AutosizeTextareaDirective implements AfterViewInit, OnDestroy {
  private readonly el = inject(ElementRef<HTMLTextAreaElement>);
  private observer?: ResizeObserver;
  private lastWidth = 0;

  ngAfterViewInit(): void {
    this.resize();
    if (typeof ResizeObserver === 'undefined') return;
    this.observer = new ResizeObserver(() => {
      // Only a width change can alter the wrap; reacting to height would loop,
      // since resize() is what changes the height in the first place.
      const width = this.el.nativeElement.clientWidth;
      if (width === this.lastWidth) return;
      this.lastWidth = width;
      this.resize();
    });
    this.observer.observe(this.el.nativeElement);
  }

  ngOnDestroy(): void {
    this.observer?.disconnect();
  }

  @HostListener('input')
  resize(): void {
    const node = this.el.nativeElement;
    // Collapse first — scrollHeight never shrinks below the current height.
    node.style.height = 'auto';
    node.style.height = `${node.scrollHeight}px`;
  }
}
