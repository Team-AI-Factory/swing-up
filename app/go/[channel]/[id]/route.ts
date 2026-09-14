import { CHANNELS } from "@/lib/growth/research";
export async function GET(request: Request, { params }: { params: Promise<{ channel: string; id: string }> }) {
  const { channel, id } = await params;
  if (!CHANNELS.includes(channel as typeof CHANNELS[number]) || !/^[a-z0-9]{20,40}$/.test(id)) return new Response("Link not found", { status: 404 });
  const url = new URL(`/research/${id}`, request.url);
  url.searchParams.set("utm_source", channel); url.searchParams.set("utm_medium", "organic_social"); url.searchParams.set("utm_campaign", "early_access"); url.searchParams.set("utm_content", id);
  return Response.redirect(url, 302);
}
