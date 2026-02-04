import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: 'standalone',
  async headers() {
    return [
      {
        // Allow iframe embedding for all routes
        source: '/:path*',
        headers: [
          {
            key: 'Content-Security-Policy',
            value: "frame-ancestors *;", // Allows embedding in iframes from any origin
          },
        ],
      },
    ];
  },
};

export default nextConfig;
