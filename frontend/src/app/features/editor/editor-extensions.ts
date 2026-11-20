import { Extensions } from '@tiptap/core';
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
import Collaboration from '@tiptap/extension-collaboration';
import CollaborationCursor from '@tiptap/extension-collaboration-cursor';
import { common, createLowlight } from 'lowlight';
import type * as Y from 'yjs';
import type { Awareness } from 'y-protocols/awareness';
import { presenceColor } from '../../shared/utils/user-utils';

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

/** The shared document an editor is bound to while people edit it together. */
export interface CollabBinding {
  doc: Y.Doc;
  awareness: Awareness;
  user: { id: string; name: string };
  /** The shared content is on screen: from here the editor may be filled or scrolled. */
  onFirstRender?: () => void;
}

/**
 * The editor's extensions. With [collab] the content comes from the shared Yjs
 * document instead of `content`, undo follows only this person's own changes,
 * and the others' cursors are drawn with their names.
 */
export function editorExtensions(collab?: CollabBinding): Extensions {
  const extensions: Extensions = [
    // Collaboration brings its own undo history, scoped to the local user.
    StarterKit.configure(collab ? { codeBlock: false, history: false } : { codeBlock: false }),
    Placeholder.configure({ placeholder: 'Start writing your documentation...' }),
    Link.configure({ openOnClick: false }),
    Image,
    Table.configure({ resizable: true }),
    TableRow,
    TableHeader,
    TableCell,
    TaskList,
    TaskItem.configure({ nested: true }),
    ColorHighlight.configure({ multicolor: true }),
    CodeBlockLowlight.configure({ lowlight: createLowlight(common) }),
  ];
  if (collab) {
    extensions.push(
      Collaboration.configure({ document: collab.doc, field: 'default', onFirstRender: collab.onFirstRender }),
      CollaborationCursor.configure({
        provider: { awareness: collab.awareness },
        user: collab.user,
        // y-prosemirror hands the client id over as a second argument; TipTap's
        // typing of the option only knows the first.
        render: renderCursor as (user: Record<string, any>) => HTMLElement,
        selectionRender: renderSelection,
      })
    );
  }
  return extensions;
}

/** The name the server attached to a cursor, and the colour of its person. */
interface CursorUser {
  id?: string;
  name?: string;
}

function renderCursor(user: CursorUser, clientId: number): HTMLElement {
  const caret = document.createElement('span');
  caret.classList.add('collaboration-cursor__caret');
  caret.dataset['liveClient'] = String(clientId);
  caret.style.setProperty('--presence', presenceColor(user.id ?? String(clientId)));
  const label = document.createElement('span');
  label.classList.add('collaboration-cursor__label');
  label.textContent = user.name ?? '';
  caret.appendChild(label);
  return caret;
}

function renderSelection(user: CursorUser) {
  return {
    class: 'collaboration-cursor__selection',
    style: `background-color: ${presenceColor(user.id ?? '', 0.22)}`,
  };
}
