/** @type {import('next').NextConfig} */

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
};

module.exports = nextConfig;
