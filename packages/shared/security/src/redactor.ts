/**
 * Redacts a request body for storage in the audit log:
 *   - drops fields whose name matches secret-ish patterns
 *   - truncates string values over 200 chars
 *   - recurses through objects/arrays
 *   - returns a fresh structure (never mutates the input)
 *
 * The audit log is for "who did what when", not for replaying the request.
 * Less data captured here is a feature, not a bug.
 */
const SECRET_KEY_RE = /password|secret|token|api[_-]?key|auth/i;
const MAX_STRING_LEN = 200;

export function redactBody(input: unknown): unknown {
  return redact(input, 0);
}

function redact(value: unknown, depth: number): unknown {
  if (depth > 6) return '<truncated>';
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') {
    return value.length > MAX_STRING_LEN
      ? `${value.slice(0, MAX_STRING_LEN)}<truncated>`
      : value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) {
    return value.slice(0, 50).map((v) => redact(v, depth + 1));
  }
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (SECRET_KEY_RE.test(k)) {
        out[k] = '<redacted>';
        continue;
      }
      out[k] = redact(v, depth + 1);
    }
    return out;
  }
  return '<unsupported>';
}
