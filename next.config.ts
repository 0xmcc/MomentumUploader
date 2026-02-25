import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    proxyClientMaxBodySize: "75mb",
    serverActions: {
      bodySizeLimit: "75mb",
    },
  },
  outputFileTracingIncludes: {
    "/api/transcribe": ["./node_modules/ffmpeg-static/ffmpeg"],
    "/api/transcribe/live": ["./node_modules/ffmpeg-static/ffmpeg"],
  },
};

export default nextConfig;
