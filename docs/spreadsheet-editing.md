# Editing Spreadsheets

Spreadsheets (`.xlsx`, `.xls`) open as a read-only preview with one tab per
sheet. Where the workbook allows it, an **Edit** button in the topbar turns that
preview into an editable grid for changing **cell values**.

This is deliberately narrow. It is a way to correct a number or a label without
leaving DocuVault — not a replacement for Excel.

## What a save preserves

Editing changes cells inside the parsed workbook and writes *that* back, rather
than rebuilding a new file from what the grid displays. The difference matters:
the grid shows formatted text, so rebuilding from it would replace every formula
with the number it last produced.

Verified to survive a save: formulas (including ones referring to edited cells),
number formats, merged cells, column widths, and every sheet in the workbook.

## What it does not preserve — and how that is handled

DocuVault reads spreadsheets with SheetJS, which does not model charts, pivot
tables, drawings or embedded images. They are absent from the object that gets
written back, so a save would drop them silently.

Rather than let that happen, **workbooks containing those parts cannot be edited
here.** They still open and render; the topbar shows no Edit button and a note
explains what was found and why. Open the file in Excel to change it.

Cell **styling** (bold, fills, colours) is likewise not written back by the
community build of SheetJS.

## Formulas

A calculated cell is shaded in the editable grid, and hovering it says so.
Typing into one replaces the formula with whatever was typed — the cell stops
being calculated. That is occasionally what you want, so it is allowed, but it
is marked so it is a deliberate act rather than a surprise.

Values that feed a formula can be edited freely; the formula stays and Excel
recalculates it on open.

## Saving and history

There is **no autosave** for spreadsheets. Changes are held in the browser until
**Save**, and navigating away with unsaved changes prompts first.

A save writes the whole file and commits it, so it appears in the document's
version history like any other change, attributed to whoever saved it. Because
`.xlsx` is a compressed archive, every save stores a complete new copy and the
diff view has nothing meaningful to show — the history is a list of versions to
restore, not a record of which cells changed.

## When to use a different format

For tabular data that lives in DocuVault and is edited often, **CSV is the better
fit**: it is text, so it goes through the normal editor, diffs properly in Git,
supports comments, and has none of the caveats above. Reach for `.xlsx` when the
file has to be an Excel workbook for somebody else's sake.
