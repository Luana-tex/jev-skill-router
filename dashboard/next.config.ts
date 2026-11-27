import type { NextConfig } from "next";
import { fileURLToPath } from "node:url";

const configuration: NextConfig = {
  devIndicators: false,
  outputFileTracingRoot: fileURLToPath(new URL("..", import.meta.url)),
  webpack(config) {
    config.resolve.extensionAlias = { ...config.resolve.extensionAlias, ".js": [".ts", ".tsx", ".js"] };
    return config;
  },
};

export default configuration;
