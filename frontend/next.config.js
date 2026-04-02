/** @type {import('next').NextConfig} */

const webpack = require("webpack");

// When deployed to GitHub Pages, assets need the repo prefix.
// When deployed to GoDaddy (custom domain), no prefix needed.
const isGitHubPages = process.env.GITHUB_PAGES === "true";

const nextConfig = {
  reactStrictMode: true,
  output: "export",
  basePath: isGitHubPages ? "/ECHO-MAPS" : "",
  assetPrefix: isGitHubPages ? "/ECHO-MAPS/" : "",
  images: {
    unoptimized: true,
  },
  trailingSlash: true,
  typescript: {
    // Allow build to succeed even with TS warnings during early development
    ignoreBuildErrors: true,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
  webpack: (config, { isServer }) => {
    // TF.js uses dynamic imports and needs Node.js polyfill fallbacks
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        path: false,
        crypto: false,
        os: false,
        stream: false,
        buffer: false,
      };
    }
    // TF.js pose-detection statically imports optional backends we don't use
    config.plugins.push(
      new webpack.IgnorePlugin({ resourceRegExp: /^@mediapipe\/pose$/ }),
      new webpack.IgnorePlugin({ resourceRegExp: /^@tensorflow\/tfjs-backend-webgpu$/ }),
    );
    return config;
  },
};

module.exports = nextConfig;
