export async function GET(request: Request) {
  const url = new URL("/research", request.url); url.searchParams.set("utm_source", "instagram"); url.searchParams.set("utm_content", "bio");
  return Response.redirect(url, 302);
}
