import { CHANNELS } from "@/lib/growth/research";
export function attribution(value: unknown) {
  const data = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const source = CHANNELS.includes(data.source as typeof CHANNELS[number]) ? String(data.source) : "direct";
  const content = typeof data.content === "string" && /^[a-zA-Z0-9_-]{1,80}$/.test(data.content) ? data.content : "";
  return { source, content };
}
export function validateSignup(data: unknown) {
  if (!data || typeof data !== "object") throw new Error("Please complete the form.");
  const value = data as Record<string, unknown>;
  if (value.website) throw new Error("Unable to accept this submission.");
  const email = typeof value.email === "string" ? value.email.trim().toLowerCase() : "";
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Enter a valid email address.");
  if (value.consent !== true) throw new Error("Please agree to early-access updates to join.");
  if (value.planIntent !== "free" && value.planIntent !== "paid_pilot") throw new Error("Choose an access option.");
  const goal = typeof value.goal === "string" ? value.goal.trim().slice(0, 240) : "";
  return { email, goal, planIntent: value.planIntent as "free" | "paid_pilot", ...attribution(value) };
}
export function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  const allowed = [new URL(request.url).origin, process.env.APP_BASE_URL, process.env.NEXT_PUBLIC_APP_URL].filter(Boolean);
  return allowed.some((value) => { try { return new URL(value!).origin === origin; } catch { return false; } });
}
export async function smallJson(request: Request) {
  if (!request.headers.get("content-type")?.includes("application/json")) throw new Error("Send a JSON form.");
  if (Number(request.headers.get("content-length") ?? 0) > 4096) throw new Error("Form is too large.");
  // Bound streamed payloads too; content-length is optional and untrusted.
  const reader = request.body?.getReader();
  if (!reader) throw new Error("Form is empty.");
  let size = 0; let text = ""; const decoder = new TextDecoder();
  while (true) {
    const part = await reader.read();
    if (part.done) break;
    size += part.value.byteLength;
    if (size > 4096) { await reader.cancel(); throw new Error("Form is too large."); }
    text += decoder.decode(part.value, { stream: true });
  }
  return JSON.parse(text + decoder.decode()) as unknown;
}
