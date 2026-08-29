import { Component, computed, input } from '@angular/core';
import { CommonModule } from '@angular/common';

/** Demos a release note can embed, by the name used in `![alt](demo:name)`. */
export const CHANGELOG_DEMOS = ['comment-on-selection'] as const;
export type ChangelogDemo = (typeof CHANGELOG_DEMOS)[number];

export function isChangelogDemo(name: string): name is ChangelogDemo {
  return (CHANGELOG_DEMOS as readonly string[]).includes(name);
}

/**
 * A short looping picture of a feature, drawn and animated in CSS.
 *
 * Release notes have always carried a still mockup per feature. A still is a
 * poor way to explain something that *happens* — selecting words, right-clicking
 * them, picking an action — so the notes can ask for one of these instead. It is
 * markup and keyframes rather than a video or a GIF: a few kilobytes, sharp at
 * any size, correct in both themes, and editable by whoever writes the note.
 *
 * Every demo runs one shared loop, so the steps below are written as
 * percentages of it and stay in step with each other. Under
 * `prefers-reduced-motion` nothing animates and the last frame is shown, which
 * is the frame that carries the point anyway.
 */
@Component({
  selector: 'app-changelog-demo',
  standalone: true,
  imports: [CommonModule],
  template: `
    @if (demo(); as name) {
      <figure class="demo" role="img" [attr.aria-label]="label()">
        <div class="stage" aria-hidden="true">
          <div class="paper">
            <div class="bar bar-heading"></div>
            <div class="bar bar-full"></div>
            <p class="prose">
              Every request <span class="target">needs a signed contract</span> before work starts
            </p>
            <div class="bar bar-full"></div>
            <div class="bar bar-short"></div>

            <span class="pin"><span>1</span></span>
          </div>

          <!-- The two labels are the point of the picture, so they are words
               rather than skeleton bars. -->
          <div class="menu">
            <div class="menu-row is-chosen">
              <span class="menu-glyph"></span>
              <span class="menu-text">Comment on selection</span>
            </div>
            <div class="menu-row">
              <span class="menu-glyph is-plain"></span>
              <span class="menu-text is-muted">Copy</span>
            </div>
          </div>

          <div class="bubble">
            <span class="bubble-line"></span>
            <span class="bubble-line is-short"></span>
          </div>

          <svg class="pointer" viewBox="0 0 12 18" width="14" height="20">
            <path d="M1 1l10 8-4.4.9L9.3 15 7 16l-2.6-5L1 14z" fill="#12343b" stroke="#fff" stroke-width="1"/>
          </svg>
        </div>
      </figure>
    }
  `,
  styles: [`
    /* The house palette of the release-note visuals, so an animated one sits
       beside the still ones without looking like a different product. */
    .demo {
      --canvas: #f6f6f2;
      --card: #ffffff;
      --edge: #d4e5e7;
      --teal: #388087;
      --teal-mid: #6fb3b8;
      --teal-light: #badfe7;
      --skeleton: #e8f0f1;
      --skeleton-strong: #c9dcde;
      --muted: #7a9a9d;
      --loop: 9s;

      margin: var(--spacing-lg) 0;
    }

    .stage {
      position: relative;
      aspect-ratio: 5 / 3;
      border-radius: 16px;
      background: var(--canvas);
      overflow: hidden;
      container-type: inline-size;
    }

    .paper {
      position: absolute;
      inset: 9% 8% 14%;
      padding: 5cqw;
      border-radius: 10px;
      border: 1px solid var(--edge);
      background: var(--card);
    }

    .bar {
      height: 2.2cqw;
      border-radius: 999px;
      background: var(--skeleton);
      margin-bottom: 3.4cqw;
    }

    .bar-heading {
      width: 42%;
      height: 3.4cqw;
      background: var(--skeleton-strong);
    }

    .bar-full { width: 100%; }
    .bar-short { width: 62%; margin-bottom: 0; }

    .prose {
      margin: 0 0 3.4cqw;
      font-size: 3.4cqw;
      line-height: 1.5;
      color: var(--muted);
    }

    /* The highlight is a background that grows from nothing, so the words are
       revealed as selected rather than blinking into a selected state. */
    .target {
      color: #12343b;
      background-image: linear-gradient(var(--teal-light), var(--teal-light));
      background-repeat: no-repeat;
      background-size: 0% 100%;
      border-radius: 3px;
      animation: sweep var(--loop) linear infinite;
    }

    @keyframes sweep {
      0%, 8% { background-size: 0% 100%; }
      18%, 92% { background-size: 100% 100%; }
      100% { background-size: 0% 100%; }
    }

    .menu {
      position: absolute;
      left: 44%;
      top: 52%;
      width: 44%;
      padding: 1.6cqw;
      border-radius: 8px;
      border: 1px solid var(--edge);
      background: var(--card);
      box-shadow: 0 10px 24px rgba(18, 52, 59, 0.16);
      opacity: 0;
      transform: scale(0.96) translateY(-2%);
      transform-origin: top left;
      animation: menu-in var(--loop) ease-out infinite;
    }

    @keyframes menu-in {
      0%, 26% { opacity: 0; transform: scale(0.96) translateY(-2%); }
      32%, 46% { opacity: 1; transform: scale(1) translateY(0); }
      50%, 100% { opacity: 0; transform: scale(0.98) translateY(0); }
    }

    .menu-row {
      display: flex;
      align-items: center;
      gap: 1.6cqw;
      padding: 1.4cqw 1.6cqw;
      border-radius: 5px;
    }

    /* The row the pointer lands on lights up just before the menu closes. */
    .is-chosen { animation: chosen var(--loop) linear infinite; }

    @keyframes chosen {
      0%, 38% { background: transparent; }
      42%, 47% { background: var(--canvas); }
      50%, 100% { background: transparent; }
    }

    .menu-glyph {
      width: 2.6cqw;
      height: 2.6cqw;
      border-radius: 3px;
      background: var(--teal-mid);
      flex-shrink: 0;
    }

    .menu-text {
      flex: 1;
      font-size: 2.5cqw;
      line-height: 1.2;
      color: #12343b;
      white-space: nowrap;
    }

    .menu-text.is-muted { color: var(--muted); }
    .menu-glyph.is-plain { background: var(--skeleton-strong); }

    .pin {
      position: absolute;
      right: -2.2cqw;
      top: 46%;
      width: 5cqw;
      height: 5cqw;
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: 50% 50% 50% 0;
      transform: rotate(-45deg) scale(0);
      background: var(--teal);
      color: #fff;
      font-size: 2.4cqw;
      font-weight: 700;
      font-family: system-ui, sans-serif;
      animation: pin-in var(--loop) cubic-bezier(0.2, 1.4, 0.4, 1) infinite;
    }

    .pin > * { transform: rotate(45deg); }

    @keyframes pin-in {
      0%, 50% { transform: rotate(-45deg) scale(0); }
      56%, 92% { transform: rotate(-45deg) scale(1); }
      100% { transform: rotate(-45deg) scale(0); }
    }

    .bubble {
      position: absolute;
      right: 4%;
      top: 60%;
      width: 30%;
      padding: 2.4cqw;
      border-radius: 8px;
      border: 1px solid var(--edge);
      background: var(--card);
      box-shadow: 0 10px 24px rgba(18, 52, 59, 0.12);
      opacity: 0;
      transform: translateY(6%);
      animation: bubble-in var(--loop) ease-out infinite;
    }

    @keyframes bubble-in {
      0%, 54% { opacity: 0; transform: translateY(6%); }
      60%, 92% { opacity: 1; transform: translateY(0); }
      100% { opacity: 0; transform: translateY(6%); }
    }

    .bubble-line {
      display: block;
      height: 1.8cqw;
      border-radius: 999px;
      background: var(--skeleton);
      margin-bottom: 1.6cqw;
    }

    .bubble-line.is-short { width: 55%; margin-bottom: 0; background: var(--skeleton-strong); }

    /* The pointer walks the same path a person would: to the end of the words
       it just selected, then onto the entry it picks. */
    .pointer {
      position: absolute;
      left: 40%;
      top: 44%;
      opacity: 0;
      animation: pointer-walk var(--loop) ease-in-out infinite;
    }

    @keyframes pointer-walk {
      0%, 10% { opacity: 0; left: 30%; top: 40%; }
      20% { opacity: 1; left: 40%; top: 45%; }
      /* Resting exactly on the menu's top-left corner, where a real menu opens
         from, rather than inside it on top of its first label. */
      28% { opacity: 1; left: 44%; top: 52%; }
      42%, 47% { opacity: 1; left: 46.5%; top: 58%; }
      54% { opacity: 0; left: 50%; top: 61%; }
      100% { opacity: 0; left: 30%; top: 40%; }
    }

    /* Motion is the whole point here, so with it switched off the demo holds the
       frame that says the most: the words selected and the comment placed. */
    @media (prefers-reduced-motion: reduce) {
      .target, .menu, .is-chosen, .pin, .bubble, .pointer { animation: none; }
      .target { background-size: 100% 100%; }
      .menu, .pointer { display: none; }
      .pin { transform: rotate(-45deg) scale(1); }
      .bubble { opacity: 1; transform: none; }
    }
  `]
})
export class ChangelogDemoComponent {
  /** Demo to draw; an unknown name renders nothing rather than an empty frame. */
  name = input.required<string>();
  /** The note's alt text — this is a picture, so it needs one. */
  label = input('');

  readonly demo = computed<ChangelogDemo | null>(() => {
    const name = this.name();
    return isChangelogDemo(name) ? name : null;
  });
}
