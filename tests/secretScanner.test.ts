import { describe, expect, it } from 'bun:test';
import {
  calculateShannonEntropy,
  maskSecretValue,
  redactTextForAi,
  scanTextForSecrets,
} from '../src/lib/secretScanner';

describe('Local Secret Scanner & Redaction', () => {
  it('detects common credential patterns with file and line while never storing full secret values', () => {
    const awsKey = ['AKIA', 'IOSFODNN7EXAMPLE'].join('');
    const googleKey = ['AIza', 'SyDaGmWKa4JsXZ-9876543210abcdefghijk'].join('');
    const source = [
      'export const name = "demo";',
      `const aws = "${awsKey}";`,
      `const g = "${googleKey}";`,
    ].join('\n');

    const findings = scanTextForSecrets('src/config.ts', source);
    expect(findings.length).toBe(2);
    expect(findings[0].path).toBe('src/config.ts');
    expect(findings[0].line).toBe(2);
    expect(findings[1].line).toBe(3);

    for (const f of findings) {
      expect(f.previewMasked).not.toBe(awsKey);
      expect(f.previewMasked).not.toBe(googleKey);
      expect(f.previewMasked).toContain('••••');
    }
  });

  it('detects high-entropy strings in .env, config, and source files without leaking full values', () => {
    const highEntropyToken = 'x9K!mQ7#pL2$vR8@zW4&nB6*cT5^yH3%jD1';
    expect(calculateShannonEntropy(highEntropyToken)).toBeGreaterThan(4.3);

    const envContent = [
      'PORT=3000',
      `CUSTOM_SIGNING_SALT=${highEntropyToken}`,
    ].join('\n');

    const envFindings = scanTextForSecrets('.env.local', envContent);
    expect(envFindings.length).toBe(1);
    expect(envFindings[0].line).toBe(2);
    expect(envFindings[0].kind).toBe('entropy');
    expect(envFindings[0].previewMasked).not.toContain(highEntropyToken);

    const { redactedContent, redactionCount } = redactTextForAi('.env.local', envContent);
    expect(redactionCount).toBeGreaterThanOrEqual(1);
    expect(redactedContent).not.toContain(highEntropyToken);
    expect(redactedContent).toContain('[REDACTED_SECRET]');
  });

  it('masks short secrets completely and leaves placeholders unflagged', () => {
    expect(maskSecretValue('abcd1234')).toBe('[REDACTED]');
    const safeEnv = 'API_KEY=your_api_key_here\nPUBLIC_URL=https://example.com/docs\n';
    expect(scanTextForSecrets('.env.example', safeEnv)).toEqual([]);
  });
});
