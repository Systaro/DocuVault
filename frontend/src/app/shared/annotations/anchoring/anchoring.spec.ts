import { anchorRecord, describeRange } from './anchoring';
import { AnchorRecord, TextQuoteSelector, findSelector, toAnchorRecord } from './selectors';
import { TextIndex } from './text-index';

/**
 * These cover the claims the anchoring design actually rests on: that a comment
 * survives edits elsewhere in the document, that it degrades to SHIFTED rather
 * than vanishing when its own text is edited, and — the one that matters most —
 * that a deleted passage orphans its comment instead of quietly resolving it.
 */
describe('anchoring', () => {
  let host: HTMLElement;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
  });

  afterEach(() => host.remove());

  /** A range over the first occurrence of `needle` in the host's text. */
  function rangeOf(needle: string): Range {
    const index = TextIndex.build(host);
    const at = index.text.indexOf(needle);
    expect(at).withContext(`"${needle}" should be present`).toBeGreaterThanOrEqual(0);
    const range = index.toRange(at, at + needle.length);
    expect(range).withContext('range should be mappable').not.toBeNull();
    return range!;
  }

  function describeQuote(needle: string): AnchorRecord {
    const record = describeRange(host, rangeOf(needle));
    expect(record).not.toBeNull();
    return record!;
  }

  it('records the quoted text with context either side', () => {
    host.innerHTML = '<p>Git stays the source of truth for every space.</p>';
    const record = describeQuote('source of truth');
    const quote = findSelector<TextQuoteSelector>(record, 'TextQuote')!;

    expect(quote.exact).toBe('source of truth');
    expect(quote.prefix).toContain('Git stays the ');
    expect(quote.suffix).toContain(' for every space.');
  });

  it('resolves exactly on an unchanged document', () => {
    host.innerHTML = '<p>Git stays the source of truth for every space.</p>';
    const record = describeQuote('source of truth');

    const result = anchorRecord(host, record);

    expect(result.state).toBe('ANCHORED');
    expect(result.range!.toString()).toBe('source of truth');
  });

  // The original defect: a percentage anchor moves as soon as anything is
  // inserted above it. A quote anchor must not.
  it('survives a paragraph inserted above it', () => {
    host.innerHTML = '<p>Git stays the source of truth for every space.</p>';
    const record = describeQuote('source of truth');

    host.innerHTML =
      '<h1>Storage</h1><p>An entirely new opening paragraph, added later.</p>' +
      '<p>Git stays the source of truth for every space.</p>';

    const result = anchorRecord(host, record);

    expect(result.state).toBe('ANCHORED');
    expect(result.range!.toString()).toBe('source of truth');
  });

  it('is unmoved by re-indentation and re-wrapping of the markup', () => {
    host.innerHTML = '<p>Git stays the source of truth for every space.</p>';
    const record = describeQuote('source of truth');

    // Same words, different whitespace and a wrapper element around them —
    // what a reformat or a regenerated page typically does.
    host.innerHTML =
      '<section>\n    <div>\n      <p>\n        Git stays the\n' +
      '        source of truth\n        for every space.\n      </p>\n    </div>\n  </section>';

    const result = anchorRecord(host, record);

    expect(result.state).toBe('ANCHORED');
    expect(result.range!.toString().replace(/\s+/g, ' ').trim()).toBe('source of truth');
  });

  it('degrades to SHIFTED when the quoted sentence is edited', () => {
    host.innerHTML = '<p>The deploy script snapshots postgres before it pulls the images.</p>';
    const record = describeQuote('snapshots postgres before it pulls the images');

    host.innerHTML = '<p>The deploy script snapshots Postgres before it pulls the new images.</p>';

    const result = anchorRecord(host, record);

    expect(result.state).toBe('SHIFTED');
    expect(result.range!.toString()).toContain('Postgres');
  });

  // The load-bearing product rule. An unfindable comment is orphaned, never
  // resolved: it is the comment most likely to still need an answer.
  it('orphans a comment whose passage was deleted, rather than resolving it', () => {
    host.innerHTML = '<p>An entire paragraph about the old retention policy.</p>';
    const record = describeQuote('the old retention policy');

    host.innerHTML = '<p>Something completely different, sharing no wording at all.</p>';

    const result = anchorRecord(host, record);

    expect(result.state).toBe('ORPHANED');
    expect(result.range).toBeNull();
  });

  it('picks the right one of two identical passages using its context', () => {
    host.innerHTML =
      '<h2>Backend</h2><p>Overview of the service.</p>' +
      '<h2>Frontend</h2><p>Overview of the service.</p>';

    const index = TextIndex.build(host);
    const second = index.text.lastIndexOf('Overview of the service.');
    const record = describeRange(host, index.toRange(second, second + 'Overview of the service.'.length)!)!;

    const result = anchorRecord(host, record);

    expect(result.state).toBe('ANCHORED');
    expect(result.position!.start).toBe(second);
  });

  it('promotes a legacy percentage anchor that still carries a snippet', () => {
    host.innerHTML = '<p>Role-based permissions are granted per space.</p>';

    // What rows created before this rework look like: flat percentages plus the
    // snippet that used to be written and never read.
    const legacy = toAnchorRecord({
      type: 'markdown',
      xPercent: 42.5,
      yPercent: 18.3,
      snippet: 'Role-based permissions'
    });

    expect(legacy!.v).toBe(0);

    const result = anchorRecord(host, legacy);

    expect(result.state).toBe('ANCHORED');
    expect(result.range!.toString()).toBe('Role-based permissions');
  });

  it('ignores text belonging to the comment UI itself', () => {
    host.innerHTML =
      '<p>Real document text.</p>' +
      '<div class="annotation-pin"><span class="pin-number">1</span></div>';

    expect(TextIndex.build(host).text).toBe('Real document text.');
  });

  it('resolves an author-given id ahead of the quote', () => {
    host.innerHTML = '<p id="pricing">Plans start at nothing at all.</p>';
    const record: AnchorRecord = {
      v: 1,
      type: 'text',
      selectors: [
        { type: 'Structural', elementId: 'pricing' },
        { type: 'TextQuote', exact: 'wording that no longer appears anywhere' }
      ]
    };

    const result = anchorRecord(host, record);

    expect(result.state).toBe('ANCHORED');
    expect(result.range!.toString()).toContain('Plans start at');
  });
});
