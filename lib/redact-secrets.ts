const SECRET_PLACEHOLDER = "[REDACTED_SECRET]";

const SECRET_ENV_NAMES = [
  "ALPHA_VANTAGE_API_KEY",
  "FMP_API_KEY",
  "MARKETAUX_API_KEY",
  "OPENAI_API_KEY",
  "CLOUDFLARE_R2_ACCESS_KEY_ID",
  "CLOUDFLARE_R2_SECRET_ACCESS_KEY",
  "TELEGRAM_BOT_TOKEN",
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "NEXTAUTH_SECRET",
  "AUTH_SECRET",
] as const;

const SECRET_KEY_NAME_PATTERN = /(^|[_-])(secret|token|password|authorization|cookie|session|api[_-]?key|access[_-]?key|secret[_-]?access[_-]?key|private[_-]?key)($|[_-])/i;

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function secretFingerprint(value: string | null | undefined) {
  const key = value?.trim();
  if (!key) return null;
  if (key.length <= 8) return `${key.slice(0, 1)}***${key.slice(-1)}`;
  return `${key.slice(0, 4)}***${key.slice(-4)}`;
}

function envSecrets() {
  return SECRET_ENV_NAMES.map((name) => process.env[name]?.trim()).filter(
    (value): value is string => Boolean(value && value.length >= 4),
  );
}

function redactString(input: string) {
  let output = input;
  for (const secret of envSecrets()) {
    output = output.replace(new RegExp(escapeRegExp(secret), "g"), SECRET_PLACEHOLDER);
  }
  return output
    .replace(/\bsk-(?:proj-)?[A-Za-z0-9_-]{16,}\b/g, SECRET_PLACEHOLDER)
    .replace(/\b(?:xoxb|xoxp|xoxa)-[A-Za-z0-9-]{16,}\b/g, SECRET_PLACEHOLDER)
    .replace(/\bAKIA[A-Z0-9]{12,}\b/g, SECRET_PLACEHOLDER)
    .replace(/\b(?:rk|sk|pk)_(?:live|test)_[A-Za-z0-9]{16,}\b/g, SECRET_PLACEHOLDER)
    .replace(/\b[0-9]{6,}:[A-Za-z0-9_-]{24,}\b/g, SECRET_PLACEHOLDER)
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{12,}\b/gi, `Bearer ${SECRET_PLACEHOLDER}`)
    .replace(/([?&](?:apikey|api_key|token|access_key|secret|key|apiKey)=)[^\s&#]+/gi, `$1${SECRET_PLACEHOLDER}`)
    .replace(/((?:authorization|cookie|set-cookie|x-api-key)\s*[:=]\s*)[^\s;,]+/gi, `$1${SECRET_PLACEHOLDER}`);
}

export function redactSecrets<T>(input: T): T {
  if (typeof input === "string") return redactString(input) as T;
  if (Array.isArray(input)) return input.map((item) => redactSecrets(item)) as T;
  if (input && typeof input === "object") {
    if (input instanceof Date) return input;
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(input)) {
      if (SECRET_KEY_NAME_PATTERN.test(key) && typeof value === "string") {
        out[key] = value ? SECRET_PLACEHOLDER : value;
      } else {
        out[key] = redactSecrets(value);
      }
    }
    return out as T;
  }
  return input;
}

export function redactSensitiveOperationalIds<T>(input: T): T {
  if (typeof input === "string") return "[REDACTED_ID]" as T;
  if (Array.isArray(input)) return input.map((item) => redactSensitiveOperationalIds(item)) as T;
  if (input && typeof input === "object") {
    if (input instanceof Date) return input;
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(input)) {
      out[key] = /(^id$|Id$|_id$|rawSignalId|candidateAlertId)/.test(key)
        ? "[REDACTED_ID]"
        : redactSensitiveOperationalIds(value);
    }
    return out as T;
  }
  return input;
}

export function withRedactionMetadata<T extends Record<string, unknown>>(
  payload: T,
  options: { redactionMode?: "secret_only" | "public_hide_ids" } = {},
): T & { secretsRedacted: true; overRedactionDetected: false; redactionMode: string; providerSecretLeakPrevented?: true; nextAction?: string } {
  const redactionMode = options.redactionMode ?? "secret_only";
  const secretRedacted = redactSecrets(payload);
  const redacted = redactionMode === "public_hide_ids" ? redactSensitiveOperationalIds(secretRedacted) : secretRedacted;
  const leaked = JSON.stringify(payload) !== JSON.stringify(secretRedacted);
  return {
    ...redacted,
    secretsRedacted: true,
    overRedactionDetected: false,
    redactionMode,
    ...(leaked ? { providerSecretLeakPrevented: true as const, nextAction: "A real secret was redacted from this response. Rotate the affected provider key if this came from a provider error." } : {}),
  };
}
