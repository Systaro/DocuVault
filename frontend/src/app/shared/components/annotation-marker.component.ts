import { Component, input, output, ViewEncapsulation } from '@angular/core';

@Component({
  selector: 'app-annotation-marker',
  standalone: true,
  template: `
    <div
      class="annotation-pin"
      [class.resolved]="resolved()"
      [class.active]="active()"
      [class.shifted]="shifted()"
      [title]="shifted() ? 'The text this comment refers to has changed' : ''"
      [style.left]="x() + unit()"
      [style.top]="y() + unit()"
      (click)="markerClick.emit($event)"
      (mouseenter)="markerHover.emit(true)"
      (mouseleave)="markerHover.emit(false)"
    >
      <span class="pin-number">{{ index() }}</span>
    </div>
  `,
  encapsulation: ViewEncapsulation.None,
  styles: [`
    .annotation-pin {
      position: absolute;
      width: 28px;
      height: 28px;
      border-radius: 50% 50% 50% 0;
      background: #f59e0b;
      border: 2px solid #fff;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      z-index: 150;
      transform: translate(-50%, -100%) rotate(-45deg);
      transition: transform 0.15s ease, background 0.15s ease, box-shadow 0.15s ease;
      pointer-events: auto;
    }

    .annotation-pin:hover,
    .annotation-pin.active {
      transform: translate(-50%, -100%) rotate(-45deg) scale(1.15);
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
    }

    .annotation-pin.active {
      background: #d97706;
    }

    .annotation-pin.resolved {
      background: #10b981;
    }

    .annotation-pin.resolved.active {
      background: #059669;
    }

    /* Fuzzy match: the pin is on the right passage, but that passage has been
       edited since the comment was written. The ring says "look before you
       trust this" without hiding the comment. */
    .annotation-pin.shifted {
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2), 0 0 0 3px rgba(180, 125, 42, 0.55);
    }

    .annotation-pin.shifted:hover,
    .annotation-pin.shifted.active {
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3), 0 0 0 3px rgba(180, 125, 42, 0.8);
    }

    .pin-number {
      transform: rotate(45deg);
      font-size: 12px;
      font-weight: 600;
      color: #fff;
      line-height: 1;
      user-select: none;
    }
  `]
})
export class AnnotationMarkerComponent {
  x = input.required<number>();
  y = input.required<number>();
  index = input.required<number>();
  resolved = input<boolean>(false);
  active = input<boolean>(false);
  /** True when the anchor only matched fuzzily — the text has since been edited. */
  shifted = input<boolean>(false);
  /**
   * Percentages for images, where a coordinate genuinely is the anchor; pixels
   * for text, where the position comes from a resolved range and so has to be
   * measured rather than guessed.
   */
  unit = input<'%' | 'px'>('%');

  markerClick = output<MouseEvent>();
  markerHover = output<boolean>();
}
