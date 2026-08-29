# Interactive regions in HTML documents

`data-dv-interactive` marks a part of an HTML document that the visual editor
must leave alone and let run — a tab row, an accordion, a filter bar, a chart.

## The problem it solves

The visual editor makes the page's own body `contenteditable` and turns the
page's scripts off for the duration of the edit. That is deliberate: a page
that rewrites its own DOM would otherwise fight the caret, and whatever its
scripts produced on screen would be written into the file on save.

For a document built around a tab row, that trade is wrong. The tabs are how
you reach the content you came to edit, and in edit mode they are dead: clicking
a tab does nothing, so the sections behind it are unreachable.

## Usage

Put the attribute on the element that wraps the interactive part:

```html
<div class="tab-row" data-dv-interactive>
  <button class="tab active" data-tab="katalog">Fragenkatalog</button>
  <button class="tab" data-tab="todos">To-dos</button>
  <button class="tab" data-tab="anhaenge">Anhänge</button>
</div>
```

No value is needed — the attribute's presence is the whole declaration. It can
appear as often as you like in one document. Nesting one marked region inside
another is pointless but harmless: the outer one wins.

### Tabs and panels: `data-dv-interactive="state"`

A tab row is only half the widget. The panels it switches between hold the
prose you came to edit, so they must stay editable — but the `active` class the
script moves between them is not yours, and saving it would change which tab
the document opens on, every time you save.

Mark the tab row as a widget and the panels as *state*:

```html
<div class="tab-row" data-dv-interactive>
  <button class="tab active" data-tab="katalog">Fragenkatalog</button>
  <button class="tab" data-tab="todos">To-dos</button>
</div>

<section class="panel active" data-panel="katalog" data-dv-interactive="state">
  <p>Edit this text normally.</p>
</section>
<section class="panel" data-panel="todos" data-dv-interactive="state">
  <p>And this.</p>
</section>
```

`="state"` keeps **the element's own attributes** as they are in the file while
leaving **everything inside it** editable and saved. Switch to the To-dos tab,
fix a sentence, save: the diff is that one sentence. The document still opens on
Fragenkatalog, because that is what the file says.

## What it does

**In edit mode:**

- The page's scripts run, so the widget works — you can switch tabs while
  editing the prose around them.
- The caret cannot enter a widget (the valueless form). It is outlined with a
  dashed border so it reads as "live, not editable". A `="state"` element stays
  editable as usual.
- On save, a widget is written back **exactly as it came off disk**, and a
  `="state"` element gets its own attributes back. Whatever the scripts did on
  screen — the tab that happens to be open, a toggled `active` class, nodes a
  chart library injected — never reaches the file.
- The editor's toolbar says **"Interactive parts stay live"** instead of
  "Scripts paused while editing", so you can tell which mode you are in.

**Everywhere else** (preview, share links, the published page) the attribute
does nothing at all. Those views already run the page normally.

## Consequences worth knowing

- **Editing the widget's own text.** You cannot type inside a widget; that is
  the point of it. To change a tab's label, use the editor's **HTML** tab, which
  edits the file's source directly.
- **Scripts run for the whole document, not just the region.** One marked
  region is enough to turn scripting on for the frame — the browser has no
  per-element switch. A script that rewrites part of the page *outside* any
  marked region will have that rewrite saved. If a script touches an area, wrap
  that area in `data-dv-interactive` too, so it is restored on save.
- **The file is the source of truth.** Because the region round-trips from
  disk, a region whose markup you change through the HTML tab takes effect the
  next time the visual editor loads the file.
- **Deleting a region works normally.** Select across it and delete: it is gone
  from the saved file, exactly as shown.

## Why not just make the whole document non-editable?

Because then you would be back to editing raw HTML for a change of one
sentence. The point of marking regions is that the parts that are *prose* stay
directly editable, while the parts that are *a small program* stay a program.

## Related

- [DocuVault State Library](docuvault-state-library.md) — for interactive
  documents that also need to persist what people do in them.
- `SECURITY.md` — DocuVault runs author-written JavaScript in preview, share
  and (for opted-in regions) edit views. That is a deliberate product decision
  and it assumes documents come from people you trust.
