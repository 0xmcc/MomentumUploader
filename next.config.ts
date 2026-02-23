import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    proxyClientMaxBodySize: "75mb",
    serverActions: {
      bodySizeLimit: "75mb",
    },
  },
};

export default nextConfig;
