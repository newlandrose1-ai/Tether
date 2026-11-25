import {
  ENTROPY_MIN_TOKEN_LENGTH,
  ENTROPY_THRESHOLD_BITS,
  SECRET_SCAN_MAX_LINE_LENGTH,
  SECRET_SCAN_SOURCE_EXTENSIONS,
  SECRET_SCAN_SPECIAL_FILENAMES,
} from '../config/ingestConfig';
import type { SecretFinding } from '../types/pipeline';

interface PatternRule {
  id: string;
  label: string;
  severity: 'high' | 'medium';
  regex: RegExp;
  /** Group index holding the secret value if different from 0 */
  secretGroup?: number;
}

const PATTERN_RULES: readonly PatternRule[] = [
  {
    id: 'pem-private-key',
    label: 'Private key block header',
    severity: 'high',
    regex: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP |ENCRYPTED )?PRIVATE KEY-----/g,
  },
  {
    id: 'aws-access-key',
    label: 'AWS access key ID',
    severity: 'high',
    regex: /\b(?:AKIA|ASIA|AROA|AIDA)[0-9A-Z]{16}\b/g,
  },
  {
    id: 'github-token',
    label: 'GitHub personal or OAuth token',
    severity: 'high',
    regex: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}\b|\bgithub_pat_[A-Za-z0-9_]{35,}\b/g,
  },
  {
    id: 'google-api-key',
    label: 'Google / Gemini API key',
    severity: 'high',
    regex: /\bAIza[0-9A-Za-z\-_]{35}\b/g,
  },
  {
    id: 'stripe-key',
    label: 'Stripe API key',
    severity: 'high',
    regex: /\b(?:sk|rk|pk)_(?:live|test)_[0-9A-Za-z]{20,}\b/g,
  },
  {
    id: 'slack-token',
    label: 'Slack bot or app token',
    severity: 'high',
    regex: /\bxox[baprs]-[0-9A-Za-z-]{10,}\b/g,
  },
  {
    id: 'ai-provider-key',
    label: 'LLM provider API key',
    severity: 'high',
    regex: /\bsk-(?:proj|ant|svcacct)-[A-Za-z0-9\-_]{20,}\b|\bsk-[A-Za-z0-9]{32,}\b/g,
  },
  {
    id: 'jwt-token',
    label: 'JSON Web Token (JWT)',
    severity: 'medium',
    regex: /\beyJ[A-Za-z0-9\-_]{10,}\.[A-Za-z0-9\-_]{10,}\.[A-Za-z0-9\-_]{10,}\b/g,
  },
  {
    id: 'connection-uri-password',
    label: 'Database / broker URI with embedded credentials',
    severity: 'high',
    regex: /\b(?:postgres(?:ql)?|mysql|mariadb|mongodb(?:\+srv)?|redis|rediss|amqps?):\/\/[^:\s/]+:([^@\s/]{4,})@/gi,
    secretGroup: 1,
  },
  {
    id: 'generic-secret-assignment',
    label: 'Hardcoded secret / credential assignment',
    severity: 'high',
    regex: /\b(?:api[_-]?key|api[_-]?secret|auth[_-]?token|access[_-]?token|refresh[_-]?token|client[_-]?secret|private[_-]?key|secret[_-]?key|signing[_-]?secret|webhook[_-]?secret|db[_-]?password|database[_-]?password|master[_-]?key|encryption[_-]?key|jwt[_-]?secret)\b\s*[:=]\s*(['"`]?)([^\s'"`#,;}{]{8,})\1/gi,
    secretGroup: 2,
  },
];

const PLACEHOLDER_RE =
  /^(?:your[_-]|example|placeholder|changeme|change[_-]?me|replace[_-]?me|dummy|sample|test[_-]|fake[_-]|xxx+|000+|\*+|<[^>]+>|\$\{[^}]+\}|process\.env\.|import\.meta\.env\.|os\.environ)/i;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const URL_PREFIX_RE = /^(?:https?:\/\/|wss?:\/\/|mailto:|data:|file:\/\/)/i;
const PATH_LIKE_RE = /^(?:\.{0,2}\/|~\/)[A-Za-z0-9._\-/]+$/;

export function maskSecretValue(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.length <= 8) {
    return '[REDACTED]';
  }
  if (trimmed.length <= 14) {
    return `${trimmed.slice(0, 2)}••••${trimmed.slice(-2)}`;
  }
  return `${trimmed.slice(0, 4)}••••${trimmed.slice(-4)}`;
}

export function calculateShannonEntropy(value: string): number {
  if (!value || value.length === 0) return 0;
  const counts = new Map<string, number>();
  for (let i = 0; i < value.length; i += 1) {
    const ch = value[i];
    counts.set(ch, (counts.get(ch) ?? 0) + 1);
  }
  let entropy = 0;
  const len = value.length;
  for (const count of counts.values()) {
    const p = count / len;
    entropy -= p * Math.log2(p);
  }
  return entropy;
}

export function isSecretScannablePath(filePath: string): boolean {
  const baseName = filePath.split('/').pop()?.toLowerCase() ?? '';
  if (!baseName) return false;
  if (baseName === '.env' || baseName.startsWith('.env.')) return true;
  if (SECRET_SCAN_SPECIAL_FILENAMES.has(baseName)) return true;

  const dotIdx = baseName.lastIndexOf('.');
  if (dotIdx === -1) return false;
  const ext = baseName.slice(dotIdx);
  return SECRET_SCAN_SOURCE_EXTENSIONS.has(ext);
}

function isEnvOrConfigPath(filePath: string): boolean {
  const baseName = filePath.split('/').pop()?.toLowerCase() ?? '';
  if (baseName === '.env' || baseName.startsWith('.env.')) return true;
  const dotIdx = baseName.lastIndexOf('.');
  if (dotIdx === -1) return false;
  const ext = baseName.slice(dotIdx);
  return (
    ext === '.env' ||
    ext === '.json' ||
    ext === '.yaml' ||
    ext === '.yml' ||
    ext === '.toml' ||
    ext === '.ini' ||
    ext === '.cfg' ||
    ext === '.conf' ||
    ext === '.properties' ||
    ext === '.tf' ||
    ext === '.tfvars'
  );
}

function hasMixedCharacterClasses(token: string): boolean {
  let classes = 0;
  if (/[a-z]/.test(token)) classes += 1;
  if (/[A-Z]/.test(token)) classes += 1;
  if (/[0-9]/.test(token)) classes += 1;
  if (/[^a-zA-Z0-9]/.test(token)) classes += 1;
  return classes >= 2;
}

function isFalsePositiveCandidate(token: string): boolean {
  if (PLACEHOLDER_RE.test(token)) return true;
  if (UUID_RE.test(token)) return true;
  if (URL_PREFIX_RE.test(token)) return true;
  if (PATH_LIKE_RE.test(token)) return true;
  if (/^sha(?:256|384|512)-[A-Za-z0-9+/=]+$/i.test(token)) return true;
  if (/^[a-z]+(?:[A-Z][a-z]+){2,}$/.test(token)) return true; // pure camelCase identifier
  if (/^[a-z]+(?:_[a-z]+){2,}$/.test(token)) return true; // pure snake_case identifier
  if (/^[a-z]+(?:-[a-z]+){2,}$/.test(token)) return true; // pure kebab-case identifier
  return false;
}

interface EntropyCandidate {
  value: string;
  column: number;
}

function extractEntropyCandidates(line: string, isEnvFile: boolean): EntropyCandidate[] {
  const candidates: EntropyCandidate[] = [];

  // 1. Quoted string literals
  const quotedRegex = /(['"`])([^\s'"`\\]{16,})\1/g;
  let match: RegExpExecArray | null;
  while ((match = quotedRegex.exec(line)) !== null) {
    candidates.push({
      value: match[2],
      column: match.index + 2,
    });
  }

  // 2. Unquoted .env assignment RHS: KEY=VALUE (stop before whitespace or inline comment ` #`)
  if (isEnvFile) {
    const envMatch = /^\s*(?:export\s+)?[A-Za-z_][A-Za-z0-9_]*\s*=\s*([^\s'"`]{16,})/.exec(line);
    if (envMatch && envMatch[1]) {
      const value = envMatch[1];
      const col = line.indexOf(value) + 1;
      candidates.push({ value, column: Math.max(1, col) });
    }
  }

  return candidates;
}

export function scanTextForSecrets(filePath: string, content: string): SecretFinding[] {
  if (!isSecretScannablePath(filePath) || !content) {
    return [];
  }

  const findings: SecretFinding[] = [];
  const baseName = filePath.split('/').pop()?.toLowerCase() ?? '';
  const isEnvFile = baseName === '.env' || baseName.startsWith('.env.');
  const isConfigFile = isEnvOrConfigPath(filePath);
  const lines = content.split(/\r?\n/);

  for (let i = 0; i < lines.length; i += 1) {
    const rawLine = lines[i];
    if (!rawLine) continue;
    const line =
      rawLine.length > SECRET_SCAN_MAX_LINE_LENGTH
        ? rawLine.slice(0, SECRET_SCAN_MAX_LINE_LENGTH)
        : rawLine;
    const lineNumber = i + 1;

    // Skip obvious pure comment lines in source files except PEM headers
    const trimmedLine = line.trim();
    const isCommentLine =
      trimmedLine.startsWith('//') ||
      (trimmedLine.startsWith('#') && !isEnvFile) ||
      trimmedLine.startsWith('/*') ||
      trimmedLine.startsWith('* ');

    const matchedRangesOnLine: Array<{ start: number; end: number }> = [];

    for (const rule of PATTERN_RULES) {
      if (isCommentLine && rule.id !== 'pem-private-key') continue;
      rule.regex.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = rule.regex.exec(line)) !== null) {
        const groupIdx = rule.secretGroup ?? 0;
        const secretValue = match[groupIdx] ?? match[0];
        if (!secretValue || PLACEHOLDER_RE.test(secretValue)) {
          continue;
        }
        if (rule.id === 'generic-secret-assignment' && isFalsePositiveCandidate(secretValue)) {
          continue;
        }

        const valueOffset = match[0].indexOf(secretValue);
        const start = match.index + Math.max(0, valueOffset);
        const end = start + secretValue.length;
        matchedRangesOnLine.push({ start, end });

        findings.push({
          id: `${filePath}:${lineNumber}:${start + 1}:${rule.id}`,
          path: filePath,
          line: lineNumber,
          column: start + 1,
          ruleId: rule.id,
          label: rule.label,
          severity: rule.severity,
          kind: 'pattern',
          previewMasked: maskSecretValue(secretValue),
        });
      }
    }

    if (isCommentLine) continue;

    // High-entropy scan in .env, config, and source files
    const minLen = isEnvFile ? 16 : ENTROPY_MIN_TOKEN_LENGTH;
    const entropyFloor = isEnvFile ? 3.8 : isConfigFile ? 4.15 : ENTROPY_THRESHOLD_BITS;

    const candidates = extractEntropyCandidates(line, isEnvFile);
    for (const candidate of candidates) {
      if (candidate.value.length < minLen) continue;
      if (isFalsePositiveCandidate(candidate.value)) continue;
      if (!hasMixedCharacterClasses(candidate.value)) continue;

      const cStart = candidate.column - 1;
      const cEnd = cStart + candidate.value.length;
      const overlapsPattern = matchedRangesOnLine.some(
        (r) => cStart < r.end && cEnd > r.start
      );
      if (overlapsPattern) continue;

      const entropy = calculateShannonEntropy(candidate.value);
      if (entropy >= entropyFloor) {
        matchedRangesOnLine.push({ start: cStart, end: cEnd });
        findings.push({
          id: `${filePath}:${lineNumber}:${candidate.column}:high-entropy`,
          path: filePath,
          line: lineNumber,
          column: candidate.column,
          ruleId: 'high-entropy-string',
          label: 'High-entropy secret candidate',
          severity: isEnvFile || isConfigFile ? 'high' : 'medium',
          kind: 'entropy',
          previewMasked: maskSecretValue(candidate.value),
          entropy: Number(entropy.toFixed(2)),
        });
      }
    }
  }

  return findings;
}

/**
 * Redacts detected secret literals on lines flagged by the local scanner before any
 * content is ever serialized for Gemini calls in downstream stages.
 */
export function redactTextForAi(filePath: string, content: string): {
  redactedContent: string;
  redactionCount: number;
} {
  if (!isSecretScannablePath(filePath) || !content) {
    return { redactedContent: content, redactionCount: 0 };
  }

  const baseName = filePath.split('/').pop()?.toLowerCase() ?? '';
  const isEnvFile = baseName === '.env' || baseName.startsWith('.env.');
  const isConfigFile = isEnvOrConfigPath(filePath);
  const minLen = isEnvFile ? 16 : ENTROPY_MIN_TOKEN_LENGTH;
  const entropyFloor = isEnvFile ? 3.8 : isConfigFile ? 4.15 : ENTROPY_THRESHOLD_BITS;

  let redactionCount = 0;
  const lines = content.split(/\r?\n/);

  const maxRedactLineLen = SECRET_SCAN_MAX_LINE_LENGTH * 4;
  const redactedLines = lines.map((rawLine) => {
    const truncatedTail = rawLine.length > maxRedactLineLen;
    let updated = truncatedTail ? rawLine.slice(0, maxRedactLineLen) : rawLine;

    for (const rule of PATTERN_RULES) {
      rule.regex.lastIndex = 0;
      updated = updated.replace(rule.regex, (...args) => {
        const fullMatch = args[0] as string;
        if (rule.secretGroup !== undefined) {
          const captured = args[rule.secretGroup] as string | undefined;
          if (!captured || PLACEHOLDER_RE.test(captured)) return fullMatch;
          if (rule.id === 'generic-secret-assignment' && isFalsePositiveCandidate(captured)) {
            return fullMatch;
          }
          redactionCount += 1;
          return fullMatch.replace(captured, '[REDACTED_SECRET]');
        }
        if (PLACEHOLDER_RE.test(fullMatch)) return fullMatch;
        redactionCount += 1;
        return '[REDACTED_SECRET]';
      });
    }

    const candidates = extractEntropyCandidates(updated, isEnvFile);
    for (const candidate of candidates) {
      if (candidate.value === '[REDACTED_SECRET]') continue;
      if (candidate.value.length < minLen) continue;
      if (isFalsePositiveCandidate(candidate.value)) continue;
      if (!hasMixedCharacterClasses(candidate.value)) continue;
      if (calculateShannonEntropy(candidate.value) >= entropyFloor) {
        redactionCount += 1;
        updated = updated.replace(candidate.value, '[REDACTED_SECRET]');
      }
    }

    return truncatedTail ? `${updated}...[long line truncated]` : updated;
  });

  return {
    redactedContent: redactedLines.join('\n'),
    redactionCount,
  };
}
