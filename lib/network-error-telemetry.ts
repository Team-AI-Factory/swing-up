const SAFE_NETWORK_ERROR_CODES = new Set([
  "ABORT_ERR",
  "CERT_HAS_EXPIRED",
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "EAI_AGAIN",
  "ECONNABORTED",
  "ECONNREFUSED",
  "ECONNRESET",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "ENOTFOUND",
  "EPIPE",
  "ERR_SSL_SSLV3_ALERT_HANDSHAKE_FAILURE",
  "ERR_SSL_TLSV1_ALERT_PROTOCOL_VERSION",
  "ERR_SSL_WRONG_VERSION_NUMBER",
  "ERR_TLS_CERT_ALTNAME_INVALID",
  "ERR_TLS_CERT_SIGNATURE_ALGORITHM_UNSUPPORTED",
  "ERR_TLS_HANDSHAKE_TIMEOUT",
  "ETIMEDOUT",
  "SELF_SIGNED_CERT_IN_CHAIN",
  "UNABLE_TO_GET_ISSUER_CERT",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "UND_ERR_BODY_TIMEOUT",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_SOCKET",
]);

const SAFE_NETWORK_ERROR_NAMES: Record<string, string> = {
  AbortError: "ABORTED",
  TimeoutError: "TIMEOUT",
};
const SAFE_NETWORK_TELEMETRY_CODES = new Set([
  ...SAFE_NETWORK_ERROR_CODES,
  ...Object.values(SAFE_NETWORK_ERROR_NAMES),
]);

const MAX_ERROR_NODES = 16;
const MAX_ERROR_DEPTH = 6;
const MAX_AGGREGATE_ERRORS = 16;

function safeProperty(value: object, property: PropertyKey) {
  try {
    return Reflect.get(value, property) as unknown;
  } catch {
    return undefined;
  }
}

function safeArrayValues(value: unknown) {
  try {
    if (!Array.isArray(value)) return [];
    const length = Math.min(Number(safeProperty(value, "length")) || 0, MAX_AGGREGATE_ERRORS);
    const entries: unknown[] = [];
    for (let index = 0; index < length; index += 1) {
      try {
        entries.push(Reflect.get(value, String(index)));
      } catch {
        // One hostile AggregateError entry must not hide other safe codes.
      }
    }
    return entries;
  } catch {
    // Array.isArray can throw for a revoked Proxy.
    return [];
  }
}

function safeTopLevelMessage(error: unknown) {
  if ((typeof error !== "object" && typeof error !== "function") || error === null) return null;
  const message = safeProperty(error, "message");
  return typeof message === "string" && message.length <= 240 ? message : null;
}

export function safeNetworkErrorCodes(error: unknown) {
  const pending: Array<{ value: unknown; depth: number }> = [{ value: error, depth: 0 }];
  const visited = new Set<object>();
  const codes = new Set<string>();

  while (pending.length > 0 && visited.size < MAX_ERROR_NODES) {
    const entry = pending.shift();
    const current = entry?.value;
    if ((typeof current !== "object" && typeof current !== "function") || current === null) continue;
    if (visited.has(current)) continue;
    visited.add(current);

    const code = safeProperty(current, "code");
    if (typeof code === "string" && SAFE_NETWORK_ERROR_CODES.has(code)) codes.add(code);
    const name = safeProperty(current, "name");
    const safeName = typeof name === "string" ? SAFE_NETWORK_ERROR_NAMES[name] : undefined;
    if (typeof safeName === "string") codes.add(safeName);
    if ((entry?.depth ?? 0) >= MAX_ERROR_DEPTH) continue;

    const cause = safeProperty(current, "cause");
    if (cause !== undefined) pending.push({ value: cause, depth: (entry?.depth ?? 0) + 1 });
    const errors = safeProperty(current, "errors");
    pending.push(...safeArrayValues(errors).map((value) => ({ value, depth: (entry?.depth ?? 0) + 1 })));
  }

  return [...codes].sort();
}

export function safeNetworkErrorTelemetry(error: unknown) {
  const codes = safeNetworkErrorCodes(error);
  return codes.length > 0 ? `network_failure:${codes.join(",")}` : null;
}

/**
 * Preserve only operational tokens created by this application. Unknown error
 * messages are replaced, never copied into telemetry, because fetch/TLS errors
 * can contain IPs, hostnames, query strings, credentials, or publisher text.
 */
export function safeProviderErrorTelemetry(error: unknown) {
  const network = safeNetworkErrorTelemetry(error);
  if (network) return network;
  const message = safeTopLevelMessage(error);
  if (!message) return "request_failed";
  if (/^(?:rate_limited|provider_error|invalid_(?:csv_payload|gdelt_payload|marketaux_payload|commerce_payload|earnings_calendar_payload|earnings_calendar_headers|feed_payload|trade_halt_payload|trade_halt_rows|trade_halt_feed)|incomplete_trade_halt_payload)$/.test(message)) {
    return message;
  }
  if (/^(?:rate_limited|temporarily_unavailable|failed|not_entitled)_http_[1-5]\d{2}$/.test(message)) {
    return message;
  }
  if (/^[a-z0-9_]{1,80}_(?:cadence_guard|rolling_quota_guard)$/.test(message)) {
    return message;
  }
  const budget = message.match(/^pr262_sensor_budget_guard:([a-z0-9_]{1,40}):(minimum_interval|rolling_24h_budget)(?:;next_retry_at=(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z))?$/);
  if (budget) return `pr262_sensor_budget_guard:${budget[1]}:${budget[2]}${budget[3] ? `;next_retry_at=${budget[3]}` : ""}`;
  return "request_failed";
}

export function safeFullSourceErrorTelemetry(error: unknown) {
  const network = safeNetworkErrorTelemetry(error);
  if (network) return network;
  const message = safeTopLevelMessage(error);
  if (!message) return "full_source_failed";
  if (/^full_source_(?:url_invalid|url_not_public_https|host_blocked|address_blocked|address_invalid|transport_failed|timeout|body_unavailable|too_many_redirects|redirect_missing_location|http_[1-5]\d{2}|content_type_unsupported|text_too_short|body_too_large|issuer_or_event_unconfirmed)$/.test(message)) {
    return message;
  }
  const transportFailures = message.match(/^full_source_transport_failed:(.+)$/)?.[1].split(",") ?? [];
  if (transportFailures.length > 0 && transportFailures.length <= 12) {
    const safeFailures: string[] = [];
    for (const failure of transportFailures) {
      const parsed = failure.match(/^(ipv4|ipv6|unknown)_([A-Z0-9_]+)$/);
      if (!parsed || !SAFE_NETWORK_TELEMETRY_CODES.has(parsed[2])) return "full_source_failed";
      safeFailures.push(`${parsed[1]}_${parsed[2]}`);
    }
    return `full_source_transport_failed:${safeFailures.join(",")}`;
  }
  return "full_source_failed";
}
