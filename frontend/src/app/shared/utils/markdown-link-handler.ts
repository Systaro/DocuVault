/**
 * Handles clicks on rendered markdown content.
 * - Anchor links (#heading) → smooth scroll
 * - Internal links (matching prefix) → calls the navigate callback
 * - External links → default browser behavior
 */
export function handleMarkdownClick(
  event: MouseEvent,
  internalPrefix: string,
  onNavigate: (filePath: string, fragment?: string) => void
): void {
  const target = event.target as HTMLElement;
  const anchor = target.closest('a');
  if (!anchor) return;

  const href = anchor.getAttribute('href');
  if (!href) return;

  // Anchor links
  if (href.startsWith('#')) {
    event.preventDefault();
    const el = document.getElementById(href.slice(1));
    if (el) el.scrollIntoView({ behavior: 'smooth' });
    // Keep the query string: the document identity lives in ?path=, so dropping
    // it turns a reload/share of the anchored URL into "new document".
    history.replaceState(null, '', window.location.pathname + window.location.search + href);
    return;
  }

  // Internal links
  if (href.startsWith(internalPrefix)) {
    event.preventDefault();
    const rest = href.substring(internalPrefix.length);
    const [pathPart, fragment] = rest.split('#');
    const filePath = decodeURIComponent(pathPart);
    onNavigate(filePath, fragment);
    if (fragment) {
      setTimeout(() => {
        const el = document.getElementById(fragment);
        if (el) el.scrollIntoView({ behavior: 'smooth' });
      }, 100);
    }
  }
}
