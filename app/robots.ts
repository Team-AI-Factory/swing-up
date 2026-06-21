import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/seo-alerts";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      { userAgent: ["Googlebot", "Bingbot", "OAI-SearchBot", "Claude-SearchBot", "Claude-User"], allow: ["/", "/alerts", "/alerts/", "/ledger", "/ledger/", "/public-ledger", "/methodology"], disallow: ["/admin", "/api", "/dashboard", "/account", "/watchlist", "/*preview*", "/*mock*", "/*candidate*"] },
      { userAgent: "*", allow: "/", disallow: ["/admin", "/api", "/dashboard", "/account", "/watchlist", "/*preview*", "/*mock*", "/*candidate*"] },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
