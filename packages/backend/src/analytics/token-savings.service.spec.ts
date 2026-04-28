import { TokenSavingsService } from './token-savings.service';

describe('TokenSavingsService', () => {
  const service = new TokenSavingsService();

  it('falls back to 1290 image tokens when buffer is unparseable', () => {
    const garbage = Buffer.from('not an image');
    const result = service.compare(garbage, '# Screen Type\nLogin');
    expect(result.imageTokensEstimate).toBe(1290);
    expect(result.markdownTokens).toBeGreaterThan(0);
    expect(result.savingsPercent).toBeGreaterThan(0);
    expect(result.savingsPercent).toBeLessThanOrEqual(100);
  });

  it('returns 0% savings when markdown is at least as large as image tokens', () => {
    const garbage = Buffer.from('not an image');
    // Repeat enough text to push markdown tokens above the 1290 fallback.
    const huge = '# Screen Type\n' + 'word '.repeat(5000);
    const result = service.compare(garbage, huge);
    expect(result.savingsPercent).toBe(0);
  });
});
