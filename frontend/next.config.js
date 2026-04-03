/** @type {import('next').NextConfig} */

const path = require("path");

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
    // Provide stub modules for optional TF.js dependencies we don't use.
    // @mediapipe/pose is only needed for BlazePose (we use MoveNet).
    // @tensorflow/tfjs-backend-webgpu requires WebGPU (we use WebGL).
    // Must apply to both server and client builds since Next.js resolves
    // all imports during static analysis.
    config.resolve.alias = {
      ...config.resolve.alias,
      "@mediapipe/pose": path.resolve(__dirname, "src/stubs/mediapipe-pose.js"),
      "@tensorflow/tfjs-backend-webgpu": path.resolve(__dirname, "src/stubs/tfjs-backend-webgpu.js"),
    };

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
    return config;
  },
};

module.exports = nextConfig;
