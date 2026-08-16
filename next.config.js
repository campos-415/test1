/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  images: {
    // The marketing pages use Unsplash photography. next/image refuses any
    // remote host that is not listed here, so leaving this out makes every
    // page carrying one fail to render.
    remotePatterns: [{ protocol: "https", hostname: "images.unsplash.com" }],
  },
};
module.exports = nextConfig;
