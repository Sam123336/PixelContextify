import { MarkdownService } from './markdown.service';

describe('MarkdownService', () => {
  const service = new MarkdownService();

  it('returns the original markdown when there is no code fence', () => {
    const input = `# Screen Type
Login

# Components
- Email field
- Password field`;
    const result = service.normalize(input);
    expect(result.markdown).toBe(input);
  });

  it('strips an outer triple-backtick fence', () => {
    const input = '```markdown\n# Screen Type\nLogin\n```';
    const result = service.normalize(input);
    expect(result.markdown).toBe('# Screen Type\nLogin');
  });

  it('reports missing required sections', () => {
    const input = '# Screen Type\nLogin';
    const result = service.normalize(input);
    expect(result.missingSections).toEqual([
      'Components',
      'Layout',
      'Design Style',
      'Problems',
      'Suggestions',
    ]);
  });

  it('reports no missing sections when all are present', () => {
    const input = `# Screen Type
x
# Components
x
# Layout
x
# Design Style
x
# Problems
x
# Suggestions
x`;
    const result = service.normalize(input);
    expect(result.missingSections).toEqual([]);
  });
});
