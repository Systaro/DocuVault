import { mergeMarkdownBlocks } from './markdown-merge';

/**
 * An outside change landing while people edit must keep both sides' work: the
 * agent's new section and the sentence somebody was just typing.
 */
describe('mergeMarkdownBlocks', () => {
  const base = ['# Setup', 'Install it.', 'Run it.', 'Done.'].join('\n\n');

  it('takes the outside change when the room has nothing unsaved', () => {
    const theirs = base.replace('Run it.', 'Run it twice.');
    expect(mergeMarkdownBlocks(base, base, theirs)).toBe(theirs);
  });

  it('keeps the live document when the outside write changed nothing', () => {
    const ours = base.replace('Done.', 'Done, finally.');
    expect(mergeMarkdownBlocks(base, ours, base)).toBe(ours);
  });

  it('combines changes to different blocks', () => {
    const ours = base.replace('Install it.', 'Install it with npm.');
    const theirs = base.replace('Done.', 'Done.\n\n## Troubleshooting');
    expect(mergeMarkdownBlocks(base, ours, theirs)).toBe(
      ['# Setup', 'Install it with npm.', 'Run it.', 'Done.', '## Troubleshooting'].join('\n\n')
    );
  });

  it('keeps both sides when the same block changed on each', () => {
    const ours = base.replace('Run it.', 'Run it now.');
    const theirs = base.replace('Run it.', 'Run it later.');
    expect(mergeMarkdownBlocks(base, ours, theirs)).toBe(
      ['# Setup', 'Install it.', 'Run it now.', 'Run it later.', 'Done.'].join('\n\n')
    );
  });
});
