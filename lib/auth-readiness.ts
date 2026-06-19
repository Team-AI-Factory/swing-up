import { cookies, headers } from "next/headers";

export type AuthReadinessSession = {
  mode: "placeholder_preview";
  ownerId: string;
  label: string;
  isAuthenticated: false;
};

const COOKIE_NAME = "swing_up_preview_owner";
const OWNER_HEADER = "x-swing-up-preview-owner";

function isUuid(value: string | undefined): value is string {
  return Boolean(value && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value));
}

export async function getAuthReadinessSession(options: { setCookie?: boolean } = {}): Promise<AuthReadinessSession> {
  const cookieStore = await cookies();
  const requestHeaders = await headers();
  const cookieOwner = cookieStore.get(COOKIE_NAME)?.value;
  const headerOwner = requestHeaders.get(OWNER_HEADER) ?? undefined;
  const ownerId = isUuid(cookieOwner) ? cookieOwner : isUuid(headerOwner) ? headerOwner : crypto.randomUUID();

  if (options.setCookie !== false && !isUuid(cookieOwner)) {
    cookieStore.set(COOKIE_NAME, ownerId, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 24 * 30,
    });
  }

  return {
    mode: "placeholder_preview",
    ownerId,
    label: "Preview owner only — real production auth is not connected yet.",
    isAuthenticated: false,
  };
}
