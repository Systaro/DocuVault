import { Browser, Frame, Page } from 'puppeteer';
import {
  launchBrowser,
  takeScreenshot,
  loadEnv,
  loginAsAdmin,
} from '../helpers/browser';
import {
  trackObject,
  trackScreenshot,
  addStep,
  printReport,
} from '../helpers/testReport';

/**
 * DocuVault HTML editor E2E test.
 *
 * Covers the promises the editor makes about a file it edits through
 * `contenteditable` — a round trip that is lossy by nature, which is why none
 * of it is autosaved:
 *
 * 1. Editing runs inside the page with its own CSS, with scripts paused
 * 2. Edits mark the file unsaved; nothing reaches the server until Save
 * 3. Closing the tab and navigating away are both guarded while unsaved
 * 4. Revert throws the working copy away
 * 5. Saving keeps everything outside <body> byte-identical
 * 6. Version history restores an older version without renaming the document
 */
describe('HTML editor', () => {
  let browser: Browser;
  let page: Page;
  let spaceId = '';
  let spacePath = '';

  const stamp = Date.now();
  const docPath = 'pages/e2e-page.html';
  const otherDocPath = 'pages/e2e-notes.md';
  const docTitle = 'E2E Testseite für den HTML-Editor';

  /** Page under test: styled, with a script whose output must never be saved. */
  const originalHtml = `<!DOCTYPE html>
<html lang="de">
<head>
  <meta charset="utf-8">
  <title>${docTitle}</title>
  <style>
    body { font-family: system-ui, sans-serif; margin: 40px; color: #1a2e30; }
    h1 { color: #388087; }
    .card { border: 1px solid #badfe7; border-radius: 12px; padding: 16px; }
  </style>
</head>
<body>
  <h1 id="heading">Willkommen</h1>
  <div class="card">
    <p id="intro">Umlaute wie ä, ö, ü und ß müssen den Umweg überstehen.</p>
  </div>
  <script>
    document.body.insertAdjacentHTML('beforeend', '<p id="from-script">Von JavaScript erzeugt</p>');
  </script>
</body>
</html>
`;

  /** The editing surface lives in an iframe; everything below reads through it. */
  async function editorFrame(): Promise<Frame> {
    const handle = await page.$('iframe.html-edit-frame');
    if (!handle) throw new Error('Editing iframe is not mounted');
    const frame = await handle.contentFrame();
    if (!frame) throw new Error('Editing iframe has no document');
    return frame;
  }

  /** Waits until the iframe has rendered the page and made it editable. */
  async function waitForEditableFrame(): Promise<void> {
    await page.waitForSelector('iframe.html-edit-frame', { timeout: 15000 });
    await page.waitForFunction(
      () => {
        const frame = document.querySelector<HTMLIFrameElement>('iframe.html-edit-frame');
        const body = frame?.contentDocument?.body;
        return !!body?.querySelector('h1') && body.isContentEditable;
      },
      { timeout: 15000 }
    );
  }

  async function clickEditorButton(label: string): Promise<void> {
    const clicked = await page.evaluate((text: string) => {
      const buttons = Array.from(
        document.querySelectorAll('.html-editor-bar button, .version-banner button')
      );
      const button = buttons.find((b) => b.textContent?.trim().startsWith(text));
      if (!button) return false;
      (button as HTMLElement).click();
      return true;
    }, label);
    if (!clicked) throw new Error(`Editor button "${label}" not found`);
  }

  async function clickDialogButton(label: string): Promise<void> {
    await page.waitForSelector('.modal-footer button', { timeout: 10000 });
    const clicked = await page.evaluate((text: string) => {
      const buttons = Array.from(document.querySelectorAll('.modal-footer button'));
      const button = buttons.find((b) => b.textContent?.trim() === text);
      if (!button) return false;
      (button as HTMLElement).click();
      return true;
    }, label);
    if (!clicked) throw new Error(`Dialog button "${label}" not found`);
    await page.waitForFunction(() => !document.querySelector('.modal'), { timeout: 10000 });
  }

  async function editorStatus(): Promise<string> {
    return page.$eval('.html-editor-status', (el) => el.textContent?.trim() ?? '');
  }

  async function saveDisabled(): Promise<boolean> {
    return page.$eval('.html-editor-save', (el) => (el as HTMLButtonElement).disabled);
  }

  /** The file as the server has it — the only copy that counts. */
  async function fetchStoredDocument(): Promise<{ title: string; content: string }> {
    return page.evaluate(
      async (id: string, path: string) => {
        const res = await fetch(`/api/spaces/${id}/documents/${path}`, {
          credentials: 'include',
        });
        return res.json();
      },
      spaceId,
      docPath
    );
  }

  async function openDocumentInEditor(): Promise<void> {
    await page.goto(`${process.env.BASE_URL}/spaces/${spacePath}/doc?path=${encodeURIComponent(docPath)}`, {
      waitUntil: 'networkidle2',
    });
    // A new release shows its notes over the app on first login.
    await page.evaluate(() => {
      const dismiss = Array.from(document.querySelectorAll('button')).find(
        (b) => b.textContent?.trim() === 'Got it'
      );
      (dismiss as HTMLElement | undefined)?.click();
    });
    await page.waitForSelector('.preview-topbar-actions .btn-edit', { timeout: 15000 });
    await page.click('.preview-topbar-actions .btn-edit');
    await waitForEditableFrame();
  }

  beforeAll(async () => {
    loadEnv();
    browser = await launchBrowser();
    page = await browser.newPage();
    await loginAsAdmin(page);

    // Own space, so the test never depends on (or disturbs) existing content.
    const created = await page.evaluate(
      async (suffix: number, path: string, html: string, title: string, notesPath: string) => {
        const post = async (url: string, body: unknown) => {
          const res = await fetch(url, {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          });
          return res.json();
        };
        const group = await post('/api/spaces', {
          name: `E2E HTML ${suffix}`,
          slug: `e2e-html-${suffix}`,
          type: 'GROUP',
        });
        const space = await post('/api/spaces', {
          name: 'Pages',
          slug: `e2e-html-pages-${suffix}`,
          type: 'REPOSITORY',
          parentId: group.id,
        });
        await post(`/api/spaces/${space.id}/documents`, {
          path,
          title,
          content: html,
          autoCommit: true,
          commitMessage: 'Add E2E test page',
        });
        await post(`/api/spaces/${space.id}/documents`, {
          path: notesPath,
          title: 'E2E Notizen',
          content: '# E2E Notizen\n\nZweites Dokument für den Navigations-Test.\n',
          autoCommit: true,
          commitMessage: 'Add E2E notes',
        });
        return { groupId: group.id, spaceId: space.id, fullPath: space.fullPath };
      },
      stamp,
      docPath,
      originalHtml,
      docTitle,
      otherDocPath
    );

    spaceId = created.spaceId;
    spacePath = created.fullPath;
    trackObject({
      type: 'Space',
      id: spaceId,
      label: created.fullPath,
      action: 'Created (fixture)',
      timestamp: new Date().toISOString(),
    });
  });

  afterAll(async () => {
    try {
      if (spaceId) {
        await page.evaluate(async (id: string) => {
          await fetch(`/api/spaces/${id}`, { method: 'DELETE', credentials: 'include' });
        }, spaceId);
        addStep(`Cleanup: deleted space ${spacePath}`, true);
        trackObject({
          type: 'Space',
          id: spaceId,
          label: spacePath,
          action: 'Deleted (cleanup)',
          timestamp: new Date().toISOString(),
        });
      }
    } catch (e) {
      addStep('Cleanup: failed', false, String(e));
    }
    printReport('DocuVault HTML Editor');
    await browser.close();
  });

  // ────────────────────────────────────────────────────────────────────
  // Test 1: the editor opens with the page's own CSS and its scripts off
  // ────────────────────────────────────────────────────────────────────
  test('opens the page for editing with its scripts paused', async () => {
    await openDocumentInEditor();

    const frame = await editorFrame();
    const state = await frame.evaluate(() => ({
      editable: document.body.isContentEditable,
      heading: document.querySelector('h1')?.textContent ?? '',
      headingColor: getComputedStyle(document.querySelector('h1')!).color,
      scriptOutput: !!document.getElementById('from-script'),
    }));

    expect(state.editable).toBe(true);
    expect(state.heading).toBe('Willkommen');
    addStep('Page body is editable in the iframe', true);

    // rgb(56, 128, 135) is the #388087 the file's own <style> sets.
    expect(state.headingColor).toBe('rgb(56, 128, 135)');
    addStep("Page renders with the file's own CSS", true);

    expect(state.scriptOutput).toBe(false);
    addStep('Page scripts are paused while editing', true);

    const ss = await takeScreenshot(page, 'html-editor-01-opened');
    trackScreenshot('Editor opened — page styled, scripts paused', ss);
  });

  // ────────────────────────────────────────────────────────────────────
  // Test 2: typing marks the file unsaved without writing anything
  // ────────────────────────────────────────────────────────────────────
  test('typing marks the file unsaved and writes nothing to the server', async () => {
    expect(await editorStatus()).toBe('');
    expect(await saveDisabled()).toBe(true);

    const frame = await editorFrame();
    await frame.click('h1');
    await page.keyboard.press('End');
    await page.keyboard.type(' im Browser geändert', { delay: 15 });

    await page.waitForFunction(
      () => document.querySelector('.html-editor-status')?.textContent?.includes('Unsaved') ?? false,
      { timeout: 10000 }
    );
    expect(await saveDisabled()).toBe(false);
    addStep('Editing marks the document as having unsaved changes', true);

    const heading = await frame.$eval('h1', (el) => el.textContent ?? '');
    expect(heading).toContain('geändert');
    addStep('Typed text (with umlauts) lands in the page', true);

    // No autosave: the server still has the untouched file.
    const stored = await fetchStoredDocument();
    expect(stored.content).toContain('<h1 id="heading">Willkommen</h1>');
    expect(stored.content).not.toContain('geändert');
    addStep('Nothing is autosaved — the stored file is unchanged', true);

    const ss = await takeScreenshot(page, 'html-editor-02-unsaved');
    trackScreenshot('Edited — unsaved changes, nothing written', ss);
  });

  // ────────────────────────────────────────────────────────────────────
  // Test 3: closing the tab is guarded while there are unsaved changes
  // ────────────────────────────────────────────────────────────────────
  test('warns before the tab is closed with unsaved changes', async () => {
    // The browser's own dialog cannot be asserted from here, so this checks the
    // thing that triggers it: a cancelled beforeunload.
    const cancelled = await page.evaluate(() => {
      const event = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    });
    expect(cancelled).toBe(true);
    addStep('Unsaved changes cancel beforeunload (browser close warning)', true);
  });

  // ────────────────────────────────────────────────────────────────────
  // Test 4: navigating to another document is held back
  // ────────────────────────────────────────────────────────────────────
  test('asks before leaving for another document, and stays when told to', async () => {
    const urlBefore = page.url();

    await page.evaluate((path: string) => {
      const link = Array.from(document.querySelectorAll('a')).find((a) =>
        a.getAttribute('href')?.includes(encodeURIComponent(path))
      );
      (link as HTMLElement | undefined)?.click();
    }, otherDocPath);

    await page.waitForSelector('.modal', { timeout: 10000 });
    const dialogTitle = await page.$eval('.modal-header h2', (el) => el.textContent?.trim() ?? '');
    expect(dialogTitle).toBe('Leave without saving?');
    expect(page.url()).toBe(urlBefore);
    addStep('Leaving for another document asks first', true);

    const ss = await takeScreenshot(page, 'html-editor-03-leave-guard');
    trackScreenshot('Navigation guard — leave without saving?', ss);

    await clickDialogButton('Keep editing');
    expect(page.url()).toBe(urlBefore);
    await waitForEditableFrame();
    expect(await editorStatus()).toContain('Unsaved');
    addStep('"Keep editing" keeps the document and its unsaved changes', true);
  });

  // ────────────────────────────────────────────────────────────────────
  // Test 5: Revert throws the working copy away
  // ────────────────────────────────────────────────────────────────────
  test('Revert discards the unsaved changes', async () => {
    await clickEditorButton('Revert');
    await clickDialogButton('Discard changes');
    await waitForEditableFrame();

    const frame = await editorFrame();
    const heading = await frame.$eval('h1', (el) => el.textContent ?? '');
    expect(heading).toBe('Willkommen');
    expect(await editorStatus()).toBe('');
    expect(await saveDisabled()).toBe(true);
    addStep('Revert restores the last saved state', true);
  });

  // ────────────────────────────────────────────────────────────────────
  // Test 6: the HTML tab round-trips, and Save keeps the file intact
  // ────────────────────────────────────────────────────────────────────
  test('edits made in the HTML tab render in the visual view and save intact', async () => {
    await page.evaluate(() => {
      const html = Array.from(document.querySelectorAll('.mode-toggle button')).find(
        (b) => b.textContent?.trim() === 'HTML'
      );
      (html as HTMLElement).click();
    });
    await page.waitForSelector('textarea.html-code', { timeout: 10000 });

    const source = await page.$eval('textarea.html-code', (el) => (el as HTMLTextAreaElement).value);
    expect(source).toContain('<style>');
    expect(source).toContain('<script>');
    // The <base> the editor needs to resolve relative assets is chrome, not content.
    expect(source).not.toContain('<base href');
    addStep('HTML tab shows the real source, without editor chrome', true);

    // Append a paragraph at the caret, the way a user would.
    await page.evaluate(() => {
      const textarea = document.querySelector<HTMLTextAreaElement>('textarea.html-code')!;
      const at = textarea.value.indexOf('</div>') + '</div>'.length;
      textarea.focus();
      textarea.setSelectionRange(at, at);
    });
    await page.keyboard.type('\n  <p id="added">Im Code-Modus ergänzt</p>', { delay: 5 });

    await page.evaluate(() => {
      const visual = Array.from(document.querySelectorAll('.mode-toggle button')).find(
        (b) => b.textContent?.trim() === 'Visual'
      );
      (visual as HTMLElement).click();
    });
    await waitForEditableFrame();

    const frame = await editorFrame();
    const added = await frame.evaluate(() => document.getElementById('added')?.textContent ?? '');
    expect(added).toBe('Im Code-Modus ergänzt');
    addStep('Source edits render in the visual view', true);

    await clickEditorButton('Save');
    await page.waitForFunction(
      () => document.querySelector('.html-editor-status')?.textContent?.includes('Saved') ?? false,
      { timeout: 15000 }
    );
    addStep('Save reports the file as saved', true);

    const stored = await fetchStoredDocument();
    expect(stored.content).toContain('<p id="added">Im Code-Modus ergänzt</p>');
    // Everything outside <body> survives a contenteditable round trip verbatim.
    expect(stored.content).toContain('<!DOCTYPE html>');
    expect(stored.content).toContain('h1 { color: #388087; }');
    expect(stored.content).toContain("document.body.insertAdjacentHTML('beforeend'");
    expect(stored.content).not.toContain('<base href');
    expect(stored.content).not.toContain('contenteditable');
    // Paused scripts never ran, so their output cannot have been serialised into
    // the page — the only "from-script" left is the literal inside the script.
    const withoutScripts = stored.content.replace(/<script[\s\S]*?<\/script>/gi, '');
    expect(withoutScripts).not.toContain('from-script');
    // Whitespace the parser lifts out of </body> must not pile up per save.
    expect(stored.content).not.toMatch(/\n{3,}/);
    expect(stored.content.endsWith('</body>\n</html>\n')).toBe(true);
    expect(stored.title).toBe(docTitle);
    addStep('Saved file keeps head, styles and scripts byte-for-byte', true);

    const ss = await takeScreenshot(page, 'html-editor-04-saved');
    trackScreenshot('Saved — code edit rendered and stored', ss);
  });

  // ────────────────────────────────────────────────────────────────────
  // Test 7: history restores an older version without renaming the file
  // ────────────────────────────────────────────────────────────────────
  test('restores an older version and keeps the document title', async () => {
    await clickEditorButton('History');
    await page.waitForSelector('.history-item', { timeout: 15000 });

    const versionCount = await page.$$eval('.history-item', (items) => items.length);
    expect(versionCount).toBeGreaterThanOrEqual(2);
    addStep(`Version history lists ${versionCount} versions`, true);

    // The oldest entry is the file as it was created.
    await page.evaluate(() => {
      const items = Array.from(document.querySelectorAll('.history-item'));
      (items[items.length - 1] as HTMLElement).click();
    });
    await page.waitForSelector('.version-banner', { timeout: 15000 });

    await page.waitForFunction(
      () => {
        const frame = document.querySelector<HTMLIFrameElement>('iframe.html-edit-frame');
        const body = frame?.contentDocument?.body;
        return !!body?.querySelector('h1') && !body.isContentEditable;
      },
      { timeout: 15000 }
    );
    addStep('An older version is shown read-only', true);

    const ss = await takeScreenshot(page, 'html-editor-05-version');
    trackScreenshot('Version history — older version, read-only', ss);

    await clickEditorButton('Restore this version');
    await clickDialogButton('Restore this version');
    await waitForEditableFrame();

    const stored = await fetchStoredDocument();
    expect(stored.content).not.toContain('<p id="added">');
    expect(stored.content).toContain('<h1 id="heading">Willkommen</h1>');
    addStep('Restore brings the older content back', true);

    // A restore re-derives the title unless the content carries one; an HTML
    // page carries none, so it must keep the title it had.
    expect(stored.title).toBe(docTitle);
    addStep('Restore keeps the document title', true);

    const versionsAfter = await page.evaluate(
      async (id: string, path: string) => {
        const res = await fetch(`/api/spaces/${id}/document-history?path=${path}`, {
          credentials: 'include',
        });
        return (await res.json()).length;
      },
      spaceId,
      docPath
    );
    expect(versionsAfter).toBe(versionCount + 1);
    addStep('Restore is a new version on top, nothing is rewound', true);
  });
});
