/** @type {import('next').NextConfig} */
const nextConfig = {
  // Enable static export for production builds
  // This allows serving the frontend directly from FastAPI without Node.js
  output: 'export',

  // Disable image optimization (not compatible with static export)
  images: {
    unoptimized: true,
  },

  // Trailing slashes help with static file serving
  trailingSlash: true,

  // Development-only rewrites (not used in production static export)
  // These proxy API/WebSocket requests to the FastAPI backend during dev
  async rewrites() {
    // Rewrites only apply in development mode (next dev)
    // In production, the static files are served from FastAPI directly
    return [
      {
        source: '/ws/:path*',
        destination: 'http://localhost:3141/ws/:path*',
      },
      {
        source: '/api/:path*',
        destination: 'http://localhost:3141/api/:path*',
      },
    ];
  },
};

export default nextConfig;
