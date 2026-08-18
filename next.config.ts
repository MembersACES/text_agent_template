import type { NextConfig } from "next";

/**
 * `frame-ancestors` is driven by CHAT_ALLOWED_ORIGINS (comma-separated exact
 * origins) — the SAME var /api/chat uses for its origin check. When UNSET we
 * fall back to `*` so the BigCommerce storefront embed is never broken by a
 * deploy; hardening activates the moment Welly's confirmed storefront domain(s)
 * are set in env.
 *
 * ⚠️ PRODUCTION TODO (API-Hardening-Plan.md, Tier 1 item 3): confirm the exact
 * storefront origin(s) with Welly and set CHAT_ALLOWED_ORIGINS, e.g.
 *   CHAT_ALLOWED_ORIGINS="https://goodness.com.au,https://www.goodness.com.au,https://sandbox-honest-to-goodness.mybigcommerce.com"
 * Until that is set this header stays `*` (current behaviour — no regression).
 */
const allowedOrigins = (process.env.CHAT_ALLOWED_ORIGINS ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const frameAncestors = allowedOrigins.length ? allowedOrigins.join(' ') : '*';

const nextConfig: NextConfig = {
  output: 'standalone',
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          {
            key: 'Content-Security-Policy',
            value: `frame-ancestors ${frameAncestors};`,
          },
          {
            // Stop MIME sniffing (Tier 1). Cheap, unconditional.
            key: 'X-Content-Type-Options',
            value: 'nosniff',
          },
        ],
      },
    ];
  },
};

export default nextConfig;
