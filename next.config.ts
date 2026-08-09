import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: "/v1/:path*",
        headers: [
          { key: "Access-Control-Allow-Origin", value: "*" },
          { key: "Access-Control-Allow-Methods", value: "GET, POST, OPTIONS" },
          {
            key: "Access-Control-Allow-Headers",
            value:
              "Content-Type, Authorization, x-session-id, x-client, Accept, " +
              "x-api-key, anthropic-version",
          },
          {
            key: "Access-Control-Expose-Headers",
            value:
              "x-gateway-provider, x-gateway-model, x-gateway-failovers, " +
              "x-gateway-session-model, x-gateway-cache, x-gateway-latency-ms, " +
              "x-rate-limit-limit, x-rate-limit-remaining",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
