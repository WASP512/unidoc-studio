import type { NextConfig } from "next";

const securityHeaders = [
  { key: "Referrer-Policy", value: "no-referrer" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

const nextConfig: NextConfig = {
  // Chromium driver must stay a plain Node dependency (not bundled).
  serverExternalPackages: ["puppeteer-core"],
  poweredByHeader: false,
  // Keep full upstream URLs out of dev logs.
  logging: { fetches: { fullUrl: false } },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
