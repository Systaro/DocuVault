/**
 * Helpers for editing a whole `.html` file in place: what gets rendered into the
 * editing iframe, and how the edited markup goes back into the original source
 * without touching anything outside `<body>`.
 */

/** Position right after the tag `re` matches, or null when it isn't there. */
function afterTag(source: string, re: RegExp): number | null {
  const match = source.match(re);
  return match?.index === undefined ? null : match.index + match[0].length;
}

/**
 * The document handed to the editing iframe: the file's own source plus a
 * `<base>` so its relative images and stylesheets keep resolving, and a minimum
 * height so an empty page still offers something to click into.
 *
 * Both additions live in `<head>`, which never travels back — only the `<body>`
 * markup is spliced into the saved file — so the file on disk stays untouched
 * by the editing chrome. A file that brings its own `<base>` keeps it.
 */
export function buildFrameDocument(source: string, baseHref: string): string {
  const head =
    (/<base\b/i.test(source) ? '' : `<base href="${baseHref.replace(/"/g, '%22')}">`) +
    '<style>body{min-height:100vh;}</style>';

  const inHead = afterTag(source, /<head\b[^>]*>/i);
  if (inHead !== null) {
    return source.slice(0, inHead) + head + source.slice(inHead);
  }

  // No <head> of its own: the snippet needs its own wrapper, and it must land
  // after any doctype — content before the doctype would drop the whole page
  // into quirks mode and render it differently than the real preview does.
  const at = afterTag(source, /<html\b[^>]*>/i) ?? afterTag(source, /<!doctype[^>]*>/i) ?? 0;
  return source.slice(0, at) + `<head>${head}</head>` + source.slice(at);
}

/**
 * Put edited body markup back into the file, leaving everything outside
 * `<body>` — doctype, `<head>`, scripts, comments — byte-identical. Files
 * without a `<body>` are fragments: there the edited markup *is* the file.
 */
export function spliceBodyHtml(source: string, bodyHtml: string): string {
  const open = source.match(/<body\b[^>]*>/i);
  const closeAt = source.toLowerCase().lastIndexOf('</body>');
  if (open?.index === undefined || closeAt < 0 || closeAt < open.index) return bodyHtml;

  // Spliced verbatim, newlines and indentation included: the serialised markup
  // already carries the whitespace the browser parsed, so re-indenting here
  // would show up as a diff on every line the user never touched.
  //
  // Except at the very end: the parser moves whitespace that followed </body>
  // and </html> into the body, so serialising that back would push another
  // blank line in front of </body> on every save. The file's own trailing gap
  // is kept instead, which makes repeated saves idempotent.
  const start = open.index + open[0].length;
  const originalGap = source.slice(start, closeAt).match(/\s*$/)?.[0] ?? '';
  return source.slice(0, start) + bodyHtml.replace(/\s*$/, '') + originalGap + source.slice(closeAt);
}
