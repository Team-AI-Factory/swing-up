import { CHANNELS, type Channel } from "@/lib/growth/research";
const ENV_CHANNEL = { facebook: "BUFFER_FACEBOOK_CHANNEL_ID", instagram: "BUFFER_INSTAGRAM_CHANNEL_ID", x: "BUFFER_X_CHANNEL_ID" } as const;
export function bufferConfiguration() {
  const missing = ["BUFFER_ACCESS_TOKEN", "BUFFER_ORGANIZATION_ID", ...Object.values(ENV_CHANNEL)].filter((key) => !process.env[key]?.trim());
  const enabled = process.env.SWING_UP_SOCIAL_PUBLISHING_ENABLED === "true";
  return { enabled, ready: enabled && missing.length === 0, missing, channels: CHANNELS.map((channel) => ({ channel, configured: Boolean(process.env[ENV_CHANNEL[channel]]) })) };
}
export class BufferError extends Error {
  constructor(message: string, readonly uncertain: boolean) { super(message); }
}
async function query<T>(document: string, variables: Record<string, unknown> = {}, mutation = false): Promise<T> {
  let response: Response;
  try {
    response = await fetch("https://api.buffer.com", { method: "POST", headers: { Authorization: `Bearer ${process.env.BUFFER_ACCESS_TOKEN}`, "Content-Type": "application/json" }, body: JSON.stringify({ query: document, variables }), signal: AbortSignal.timeout(20_000), cache: "no-store" });
  } catch { throw new BufferError("Buffer connection interrupted; reconcile before retrying", mutation); }
  if (!response.ok) throw new BufferError(`Buffer HTTP ${response.status}`, mutation && response.status >= 500);
  let payload: { data?: T; errors?: unknown[] };
  try { payload = await response.json(); } catch { throw new BufferError("Buffer response could not be read", mutation); }
  if (!payload.data || payload.errors?.length) throw new BufferError("Buffer rejected the API request; inspect the account configuration", mutation);
  return payload.data;
}
export async function verifyBufferChannels() {
  const data = await query<{ channels: { id: string; name: string; service: string }[] }>("query($input: ChannelsInput!) { channels(input: $input) { id name service } }", { input: { organizationId: process.env.BUFFER_ORGANIZATION_ID } });
  for (const channel of CHANNELS) {
    const match = data.channels.find((item) => item.id === process.env[ENV_CHANNEL[channel]]);
    if (!match || match.service !== (channel === "x" ? "twitter" : channel)) throw new BufferError(`The ${channel} channel does not match its configured account`, false);
    if (!/swing[\s_.-]*up/i.test(match.name)) throw new BufferError(`The ${channel} account name must identify Swing Up before automatic publishing`, false);
  }
  return data.channels.filter((item) => Object.values(ENV_CHANNEL).some((key) => process.env[key] === item.id));
}
export type ProviderPost = { id: string; status: string; externalLink: string | null; text?: string; channelId?: string; metrics?: { type: string; value: number; unit: string }[] | null };
export async function publishBufferImage(channel: Channel, text: string, imageUrl: string) {
  const metadata = channel === "instagram" ? { instagram: { type: "post", shouldShareToFeed: true } } : channel === "facebook" ? { facebook: { type: "post" } } : undefined;
  const result = await query<{ createPost: { __typename: string; post?: ProviderPost; message?: string } }>(`mutation($input: CreatePostInput!) { createPost(input: $input) { __typename ... on PostActionSuccess { post { id status externalLink } } ... on MutationError { message } } }`, { input: {
    channelId: process.env[ENV_CHANNEL[channel]], text, assets: [{ image: { url: imageUrl } }], schedulingType: "automatic", mode: "shareNow", needsApproval: false, aiAssisted: true, ...(metadata ? { metadata } : {}),
  } }, true);
  if (!result.createPost.post) throw new BufferError("Buffer did not accept the post; inspect channel permissions or publishing limits", false);
  return result.createPost.post;
}
export async function readBufferPost(id: string) {
  const data = await query<{ post: ProviderPost }>("query($input: PostInput!) { post(input: $input) { id status externalLink } }", { input: { id } });
  return data.post;
}
export async function findBufferPost(channel: Channel, marker: string, after: Date) {
  const data = await query<{ posts: { edges: { node: ProviderPost }[] } }>("query($input: PostsInput!) { posts(input: $input, first: 100) { edges { node { id status externalLink text channelId } } } }", { input: { organizationId: process.env.BUFFER_ORGANIZATION_ID, filter: { channelIds: [process.env[ENV_CHANNEL[channel]]], startDate: after.toISOString() } } });
  return data.posts.edges.map((edge) => edge.node).find((post) => post.text?.includes(marker)) || null;
}
export function deliveryState(post: ProviderPost) {
  if (post.status === "sent" || post.status === "published") return "published";
  if (post.status === "error" || post.status === "failed") return "failed";
  if (post.status === "draft" || post.status === "needs_approval") return "held";
  return "scheduled";
}
