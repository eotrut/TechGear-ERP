import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // Enables forbidden() and unauthorized(), which render app/forbidden.tsx
    // and app/unauthorized.tsx. Without this the calls in src/lib/rbac/guard.ts
    // have no effect.
    authInterrupts: true,
  },

  // The floating dev-tools badge overlaps the sidebar and lands in every
  // Playwright screenshot. Turn it off so captures show only our UI.
  devIndicators: false,

  typescript: {
    // Never ship a build that does not typecheck.
    ignoreBuildErrors: false,
  },
  eslint: {
    ignoreDuringBuilds: false,
  },

  webpack: (config) => {
    // The screenshot sweep writes into docs/screenshots and .playwright-cli
    // while the dev server is serving. Without this the watcher recompiles
    // mid-request and can read a half-written manifest, which surfaces as
    // `SyntaxError: Unexpected end of JSON input` and an intermittent 500.
    config.watchOptions = {
      ...config.watchOptions,
      ignored: [
        "**/node_modules/**",
        "**/.git/**",
        "**/.next/**",
        "**/docs/**",
        "**/.playwright-cli/**",
        "**/.playwright/**",
      ],
    };
    return config;
  },
};

export default nextConfig;
