import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Copilot SDK spawns a native runtime binary — load it from node_modules, don't bundle it
  serverExternalPackages: ["@github/copilot-sdk"],
  devIndicators: false,
  experimental: {
    // The sign-in proxy buffers request bodies; larger ones would be silently cut (screenshots/videos for bugs)
    proxyClientMaxBodySize: "250mb",
  },
};

export default nextConfig;
