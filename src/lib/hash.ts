/**
 * Deterministic Hashing & Secret Sanitization Utility
 * 
 * Provides SHA-256 hashing for content revisions and canonical snapshot manifests,
 * operating uniformly across browser and server/test runtimes.
 */

// Pure JS SHA-256 implementation ensures synchronous deterministic hashing
// across any environment (browser, web worker, node, bun) without async overhead.
function sha256Sync(str: string): string {
  // UTF-8 encode
  const utf8 = unescape(encodeURIComponent(str));
  const words: number[] = [];
  for (let i = 0; i < utf8.length; i++) {
    words[i >>> 2] |= (utf8.charCodeAt(i) & 0xff) << (24 - (i % 4) * 8);
  }

  // Pre-processing
  const bitLen = utf8.length * 8;
  words[bitLen >>> 5] |= 0x80 << (24 - (bitLen % 32));
  words[(((bitLen + 64) >>> 9) << 4) + 15] = bitLen;

  // Initial hash values
  let h0 = 0x6a09e667;
  let h1 = 0xbb67ae85;
  let h2 = 0x3c6ef372;
  let h3 = 0xa54ff53a;
  let h4 = 0x510e527f;
  let h5 = 0x9b05688c;
  let h6 = 0x1f83d9ab;
  let h7 = 0x5be0cd19;

  // Constants
  const K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ];

  const w: number[] = new Array(64);

  for (let i = 0; i < words.length; i += 16) {
    for (let t = 0; t < 16; t++) {
      w[t] = words[i + t] | 0;
    }
    for (let t = 16; t < 64; t++) {
      const s0 =
        (((w[t - 15] >>> 7) | (w[t - 15] << 25)) ^
          ((w[t - 15] >>> 18) | (w[t - 15] << 14)) ^
          (w[t - 15] >>> 3)) | 0;
      const s1 =
        (((w[t - 2] >>> 17) | (w[t - 2] << 15)) ^
          ((w[t - 2] >>> 19) | (w[t - 2] << 13)) ^
          (w[t - 2] >>> 10)) | 0;
      w[t] = (w[t - 16] + s0 + w[t - 7] + s1) | 0;
    }

    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    let f = h5;
    let g = h6;
    let h = h7;

    for (let t = 0; t < 64; t++) {
      const S1 =
        (((e >>> 6) | (e << 26)) ^
          ((e >>> 11) | (e << 21)) ^
          ((e >>> 25) | (e << 7))) | 0;
      const ch = ((e & f) ^ (~e & g)) | 0;
      const temp1 = (h + S1 + ch + K[t] + w[t]) | 0;
      const S0 =
        (((a >>> 2) | (a << 30)) ^
          ((a >>> 13) | (a << 19)) ^
          ((a >>> 22) | (a << 10))) | 0;
      const maj = ((a & b) ^ (a & c) ^ (b & c)) | 0;
      const temp2 = (S0 + maj) | 0;

      h = g;
      g = f;
      f = e;
      e = (d + temp1) | 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) | 0;
    }

    h0 = (h0 + a) | 0;
    h1 = (h1 + b) | 0;
    h2 = (h2 + c) | 0;
    h3 = (h3 + d) | 0;
    h4 = (h4 + e) | 0;
    h5 = (h5 + f) | 0;
    h6 = (h6 + g) | 0;
    h7 = (h7 + h) | 0;
  }

  const toHex = (n: number) => (n >>> 0).toString(16).padStart(8, '0');
  return `${toHex(h0)}${toHex(h1)}${toHex(h2)}${toHex(h3)}${toHex(h4)}${toHex(h5)}${toHex(h6)}${toHex(h7)}`;
}

/**
 * Computes deterministic SHA-256 hash for content string
 */
export function computeContentHash(content: string): string {
  return sha256Sync(content);
}

/**
 * Canonical JSON serializer ensuring keys are sorted deterministically
 */
export function canonicalStringify(val: unknown): string {
  if (val === null || typeof val !== 'object') {
    return JSON.stringify(val);
  }

  if (Array.isArray(val)) {
    return `[${val.map((item) => canonicalStringify(item)).join(',')}]`;
  }

  const keys = Object.keys(val as Record<string, unknown>).sort();
  const pairs = keys.map((key) => {
    const v = (val as Record<string, unknown>)[key];
    return `${JSON.stringify(key)}:${canonicalStringify(v)}`;
  });

  return `{${pairs.join(',')}}`;
}

/**
 * Computes deterministic manifest hash from structured manifest
 */
export function computeManifestHash(manifest: unknown): string {
  const canonical = canonicalStringify(manifest);
  return sha256Sync(canonical);
}

/**
 * Known secret patterns that must never enter snapshots or audit manifests
 */
const SENSITIVE_PATH_PATTERNS = [
  /^\.env(\..+)?$/i,
  /\.pem$/i,
  /\.key$/i,
  /\.pfx$/i,
  /\.p12$/i,
  /id_rsa/i,
  /id_ed25519/i,
  /credentials\.json$/i,
  /service-account.*\.json$/i,
];

const SENSITIVE_CONTENT_PATTERNS = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /AIzaSy[A-Za-z0-9_-]{33}/, // Google API Key
  /ghp_[A-Za-z0-9]{36}/,     // GitHub personal token
  /sk_live_[A-Za-z0-9]{24}/,  // Stripe live key
  /Bearer\s+[A-Za-z0-9._~+/-]{20,}/i,
];

/**
 * Checks if a path should be excluded from snapshots to prevent credential leakage
 */
export function isPathSensitive(path: string): boolean {
  const filename = path.split('/').pop() || path;
  return SENSITIVE_PATH_PATTERNS.some((pattern) => pattern.test(filename) || pattern.test(path));
}

/**
 * Checks if text content contains detected private keys or raw tokens
 */
export function containsSensitiveContent(content: string): boolean {
  return SENSITIVE_CONTENT_PATTERNS.some((pattern) => pattern.test(content));
}
