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
] as const;

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function secretFingerprint(value: string | null | undefined) {
  const key = value?.trim();
  if (!key) return null;
  if (key.length <= 8) return `${key.slice(0, 1)}***${key.slice(-1)}`;
  return `${key.slice(0, 4)}***${key.slice(-4)}`;
}

export const redactionMode = "secret_only" as const;

function redactString(input: string) {
  let output = input;
  for (const envName of SECRET_ENV_NAMES) {
    const secret = process.env[envName]?.trim();
    if (secret && secret.length >= 4) {
      output = output.replace(new RegExp(escapeRegExp(secret), "g"), SECRET_PLACEHOLDER);
    }
  }
  output = output
    .replace(/\b(?:sk-[A-Za-z0-9_\-]{16,}|sk_live_[A-Za-z0-9_\-]{12,}|sk_test_[A-Za-z0-9_\-]{12,})\b/g, SECRET_PLACEHOLDER)
    .replace(/\bAKIA[A-Z0-9]{12,}\b/g, SECRET_PLACEHOLDER)
    .replace(/\b(?:Bearer\s+)[A-Za-z0-9._\-]{12,}/gi, `Bearer ${SECRET_PLACEHOLDER}`)
    .replace(/([?&](?:apikey|api_key|token|access_token|access_key|secret|secret_access_key|key)=)[^\s&#]+/gi, `$1${SECRET_PLACEHOLDER}`)
    .replace(/((?:cookie|set-cookie|authorization)\s*[:=]\s*)[^;\n]+/gi, `$1${SECRET_PLACEHOLDER}`);
  return output;
}

export function redactSecrets<T>(input: T): T {
  if (typeof input === "string") return redactString(input) as T;
  if (Array.isArray(input)) return input.map((item) => redactSecrets(item)) as T;
  if (input && typeof input === "object") {
    if (input instanceof Date) return input;
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(input)) {
      if (/secret|token|password|authorization|apiKey|api_key|accessKeyId|secretAccessKey/i.test(key) && typeof value === "string") {
        out[key] = value ? SECRET_PLACEHOLDER : value;
      } else {
        out[key] = redactSecrets(value);
      }
    }
    return out as T;
  }
  return input;
}

export function withRedactionMetadata<T extends Record<string, unknown>>(payload: T): T & { secretsRedacted: true; redactionMode: "secret_only"; providerSecretLeakPrevented?: true; nextAction?: string } {
  const redacted = redactSecrets(payload);
  const before = JSON.stringify(payload);
  const after = JSON.stringify(redacted);
  const leaked = before !== after;
  return {
    ...redacted,
    secretsRedacted: true,
    redactionMode,
    ...(leaked ? { providerSecretLeakPrevented: true as const, nextAction: "Rotate the affected provider key and update Railway variables." } : {}),
  };
}
