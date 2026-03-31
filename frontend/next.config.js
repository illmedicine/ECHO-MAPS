/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: "export",
  basePath: process.env.GITHUB_PAGES === "true" ? "/ECHO-MAPS" : "",
  assetPrefix: process.env.GITHUB_PAGES === "true" ? "/ECHO-MAPS/" : "",
  images: {
    unoptimized: true,
  },
  trailingSlash: true,
};

module.exports = nextConfig;
