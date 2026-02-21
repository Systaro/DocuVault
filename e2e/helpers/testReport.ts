import * as fs from 'fs';
import * as path from 'path';

interface TrackedObject {
  type: string;
  id: string;
  label: string;
  action: string;
  url?: string;
  timestamp: string;
}

interface TrackedScreenshot {
  label: string;
  path: string;
}

interface TestStep {
  name: string;
  passed: boolean;
  error?: string;
}

const objects: TrackedObject[] = [];
const screenshots: TrackedScreenshot[] = [];
const steps: TestStep[] = [];

export function trackObject(obj: TrackedObject): void {
  objects.push(obj);
}

export function trackScreenshot(label: string, screenshotPath: string): void {
  screenshots.push({ label, path: screenshotPath });
}

export function addStep(name: string, passed: boolean, error?: string): void {
  steps.push({ name, passed, error });
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function imageToBase64(filePath: string): string {
  if (!fs.existsSync(filePath)) return '';
  const data = fs.readFileSync(filePath);
  return data.toString('base64');
}

export function generateReport(title: string): string {
  const reportsDir = path.join(__dirname, '..', 'reports');
  if (!fs.existsSync(reportsDir)) {
    fs.mkdirSync(reportsDir, { recursive: true });
  }

  const passedCount = steps.filter(s => s.passed).length;
  const failedCount = steps.filter(s => !s.passed).length;
  const timestamp = new Date().toISOString();

  const stepsHtml = steps
    .map(
      s => `
    <div class="step ${s.passed ? 'passed' : 'failed'}">
      <span class="step-icon">${s.passed ? '\u2705' : '\u274C'}</span>
      <span class="step-name">${escapeHtml(s.name)}</span>
      ${s.error ? `<span class="step-error">${escapeHtml(s.error)}</span>` : ''}
    </div>`
    )
    .join('\n');

  const screenshotHtml = screenshots
    .map(s => {
      const b64 = imageToBase64(s.path);
      return `
      <div class="screenshot-item">
        <h3>${escapeHtml(s.label)}</h3>
        ${b64 ? `<img src="data:image/png;base64,${b64}" alt="${escapeHtml(s.label)}" />` : '<p>Screenshot not found</p>'}
      </div>`;
    })
    .join('\n');

  const objectsHtml =
    objects.length > 0
      ? `
    <table class="objects-table">
      <thead>
        <tr><th>Type</th><th>ID</th><th>Label</th><th>Action</th><th>Timestamp</th></tr>
      </thead>
      <tbody>
        ${objects
          .map(
            o => `
          <tr>
            <td>${escapeHtml(o.type)}</td>
            <td><code>${escapeHtml(o.id)}</code></td>
            <td>${escapeHtml(o.label)}</td>
            <td>${escapeHtml(o.action)}</td>
            <td>${escapeHtml(o.timestamp)}</td>
          </tr>`
          )
          .join('\n')}
      </tbody>
    </table>`
      : '<p>No objects tracked.</p>';

  const html = `<!DOCTYPE html>
<html><head>
  <meta charset="utf-8">
  <title>${escapeHtml(title)}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f5f5f5; color: #333; padding: 32px; }
    .report { max-width: 1200px; margin: 0 auto; }
    h1 { font-size: 24px; margin-bottom: 4px; }
    .timestamp { color: #888; font-size: 13px; margin-bottom: 24px; }
    .summary { display: flex; gap: 16px; margin-bottom: 32px; }
    .card { background: #fff; border-radius: 8px; padding: 20px; flex: 1; text-align: center; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
    .card-value { font-size: 32px; font-weight: 700; }
    .card-label { font-size: 13px; color: #888; margin-top: 4px; }
    .card.passed .card-value { color: #2e7d32; }
    .card.failed .card-value { color: #c62828; }
    .card.objects .card-value { color: #1565c0; }
    section { background: #fff; border-radius: 8px; padding: 24px; margin-bottom: 24px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
    section h2 { font-size: 18px; margin-bottom: 16px; border-bottom: 1px solid #eee; padding-bottom: 8px; }
    .step { display: flex; align-items: center; gap: 8px; padding: 8px 0; border-bottom: 1px solid #f0f0f0; }
    .step:last-child { border-bottom: none; }
    .step-icon { font-size: 16px; }
    .step-name { font-size: 14px; }
    .step-error { font-size: 12px; color: #c62828; margin-left: auto; }
    .screenshot-item { margin-bottom: 24px; }
    .screenshot-item h3 { font-size: 14px; margin-bottom: 8px; color: #555; }
    .screenshot-item img { max-width: 100%; border: 1px solid #ddd; border-radius: 4px; }
    .objects-table { width: 100%; border-collapse: collapse; font-size: 13px; }
    .objects-table th, .objects-table td { padding: 8px 12px; border: 1px solid #eee; text-align: left; }
    .objects-table th { background: #f9f9f9; font-weight: 600; }
    .objects-table code { background: #f0f0f0; padding: 2px 6px; border-radius: 3px; font-size: 12px; }
  </style>
</head><body>
  <div class="report">
    <h1>${escapeHtml(title)}</h1>
    <p class="timestamp">${timestamp}</p>
    <div class="summary">
      <div class="card passed"><div class="card-value">${passedCount}</div><div class="card-label">Passed</div></div>
      <div class="card failed"><div class="card-value">${failedCount}</div><div class="card-label">Failed</div></div>
      <div class="card objects"><div class="card-value">${objects.length}</div><div class="card-label">Objects Tracked</div></div>
    </div>
    <section><h2>Test Steps</h2>${stepsHtml}</section>
    <section><h2>Screenshots</h2>${screenshotHtml}</section>
    <section><h2>Touched Objects</h2>${objectsHtml}</section>
  </div>
</body></html>`;

  const reportPath = path.join(reportsDir, `report-${Date.now()}.html`);
  fs.writeFileSync(reportPath, html);
  return reportPath;
}

export function printReport(title: string): void {
  const passedCount = steps.filter(s => s.passed).length;
  const failedCount = steps.filter(s => !s.passed).length;

  console.log(`\n\ud83e\uddea E2E Test Report \u2014 ${title}`);
  console.log('\u2501'.repeat(50));
  for (const step of steps) {
    console.log(`${step.passed ? '\u2705' : '\u274c'} ${step.name}${step.error ? ` \u2014 ${step.error}` : ''}`);
  }
  if (objects.length > 0) {
    console.log('\n\ud83d\udccb Touched Objects:');
    for (const obj of objects) {
      console.log(`   \ud83d\udd0d ${obj.type} #${obj.id} \u2014 ${obj.label} \u2014 ${obj.action}`);
    }
  }
  console.log('\n' + '\u2501'.repeat(50));
  console.log(`\ud83d\udcca Results: ${passedCount}/${passedCount + failedCount} passed | ${objects.length} objects touched`);
  const reportPath = generateReport(title);
  console.log(`\ud83d\udcc4 HTML Report: ${reportPath}\n`);
}
