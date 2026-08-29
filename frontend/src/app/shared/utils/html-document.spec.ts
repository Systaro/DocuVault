import {
  buildFrameDocument,
  hasInteractiveRegions,
  prepareInteractiveRegions,
  restoreInteractiveRegions,
  spliceBodyHtml
} from './html-document';

/**
 * The promise `data-dv-interactive` makes is that a region comes back out of
 * the editor exactly as it went in, however its scripts rearranged it on
 * screen. These check that promise from both ends.
 */
describe('interactive regions', () => {
  const tabRow = `<div class="tabs" data-dv-interactive>
      <button class="tab active" data-tab="a">Fragenkatalog</button>
      <button class="tab" data-tab="b">To-dos</button>
    </div>`;

  const page = `<!DOCTYPE html>
<html lang="de"><head><title>Katalog</title></head>
<body>
    <h1>Fragenkatalog</h1>
    ${tabRow}
    <p>Prose the author edits.</p>
    <script>document.querySelector('.tabs').addEventListener('click', () => {});</script>
</body></html>`;

  it('leaves a page without regions untouched', () => {
    const plain = '<html><body><p>hi</p></body></html>';

    expect(hasInteractiveRegions(plain)).toBe(false);
    expect(prepareInteractiveRegions(plain).source).toBe(plain);
    expect(prepareInteractiveRegions(plain).regions.size).toBe(0);
    expect(restoreInteractiveRegions('<p>hi</p>', new Map())).toBe('<p>hi</p>');
  });

  it('locks each region against the caret and records what is on disk', () => {
    const prepared = prepareInteractiveRegions(page);

    expect(prepared.regions.size).toBe(1);
    expect(prepared.source).toContain('data-dv-region="0"');
    expect(prepared.source).toContain('contenteditable="false"');
    // What was recorded is the file's markup, without the editor's own tagging.
    expect(prepared.regions.get('0')?.markup).toContain('class="tab active" data-tab="a"');
    expect(prepared.regions.get('0')?.markup).not.toContain('data-dv-region');
    expect(prepared.regions.get('0')?.markup).not.toContain('contenteditable');
    // Written back the way authors write it, not as the serialiser expands it.
    expect(prepared.regions.get('0')?.markup).toContain('data-dv-interactive>');
  });

  it('saves the region as it was on disk, not as its scripts left it', () => {
    const prepared = prepareInteractiveRegions(page);
    const frame = new DOMParser().parseFromString(prepared.source, 'text/html');

    // What a tab script does when someone clicks the second tab while editing.
    const tabs = frame.querySelectorAll('.tab');
    tabs[0].classList.remove('active');
    tabs[1].classList.add('active');
    frame.body.appendChild(document.createElement('p'));
    const edited = frame.body.querySelector('p') as HTMLElement;
    edited.textContent = 'A sentence typed outside the region.';

    const restored = restoreInteractiveRegions(frame.body.innerHTML, prepared.regions);

    // The widget is back to the file's version …
    expect(restored).toContain('class="tab active" data-tab="a"');
    expect(restored).not.toContain('class="tab active" data-tab="b"');
    expect(restored).toContain('data-dv-interactive>');
    expect(restored).not.toContain('data-dv-region');
    expect(restored).not.toContain('contenteditable');
    // … and the edit outside it survived.
    expect(restored).toContain('A sentence typed outside the region.');
  });

  it('round-trips a region unchanged when nothing was edited', () => {
    const prepared = prepareInteractiveRegions(page);
    const frame = new DOMParser().parseFromString(prepared.source, 'text/html');

    const restored = restoreInteractiveRegions(frame.body.innerHTML, prepared.regions);
    // Compared against the file's own text rather than a re-parse of it: the
    // point is that the markup survives, valueless attribute and all.
    const bodyInFile = page.slice(page.indexOf('<body>') + '<body>'.length, page.indexOf('</body>'));

    expect(restored.trim()).toBe(bodyInFile.trim());
  });

  it('records only the outermost of nested regions', () => {
    const nested = `<body><section data-dv-interactive><div data-dv-interactive>x</div></section></body>`;

    const prepared = prepareInteractiveRegions(nested);

    expect(prepared.regions.size).toBe(1);
    expect(prepared.regions.get('0')?.markup).toContain('<div data-dv-interactive');
  });

  it('keeps a state element\'s attributes but saves the edits inside it', () => {
    const withPanels = `<body>
      <div class="tabs" data-dv-interactive><button class="tab active">A</button></div>
      <section class="panel active" data-panel="a" data-dv-interactive="state"><p>Prose.</p></section>
      <section class="panel" data-panel="b" data-dv-interactive="state"><p>More.</p></section>
    </body>`;

    const prepared = prepareInteractiveRegions(withPanels);
    expect(prepared.regions.get('1')?.mode).toBe('state');
    // A state element stays editable — that is the whole point of it.
    const frame = new DOMParser().parseFromString(prepared.source, 'text/html');
    expect(frame.querySelector('[data-panel="a"]')?.getAttribute('contenteditable')).toBeNull();

    // The script moves `active` to the second panel; the author edits its text.
    frame.querySelector('[data-panel="a"]')!.classList.remove('active');
    const second = frame.querySelector('[data-panel="b"]')!;
    second.classList.add('active');
    second.querySelector('p')!.textContent = 'Edited while the tab was open.';

    const restored = restoreInteractiveRegions(frame.body.innerHTML, prepared.regions);

    expect(restored).toContain('Edited while the tab was open.');
    expect(restored).toContain('<section class="panel active" data-panel="a"');
    expect(restored).toContain('<section class="panel" data-panel="b"');
    expect(restored).not.toContain('data-dv-region');
    expect(restored).toContain('data-dv-interactive="state"');
  });

  it('keeps what is on screen when the author deleted the region', () => {
    const prepared = prepareInteractiveRegions(page);

    // The region is gone from the edited body — nothing to put back.
    const restored = restoreInteractiveRegions('<p>Only prose left.</p>', prepared.regions);

    expect(restored).toBe('<p>Only prose left.</p>');
  });

  it('survives the splice back into the file', () => {
    const prepared = prepareInteractiveRegions(page);
    const frame = new DOMParser().parseFromString(prepared.source, 'text/html');
    frame.querySelectorAll('.tab')[1].classList.add('active');

    const saved = spliceBodyHtml(
      page,
      restoreInteractiveRegions(frame.body.innerHTML, prepared.regions)
    );

    expect(saved.startsWith('<!DOCTYPE html>')).toBe(true);
    expect(saved).toContain('<title>Katalog</title>');
    expect(saved).toContain('class="tab active" data-tab="a"');
    expect(saved).not.toContain('data-dv-region');
  });

  it('gives the frame an outline for regions, and keeps the page style rules', () => {
    const frameDoc = buildFrameDocument(page, '/api/spaces/1/files/docs/');

    expect(frameDoc).toContain('[data-dv-interactive]');
    expect(frameDoc).toContain('<base href="/api/spaces/1/files/docs/">');
  });
});
