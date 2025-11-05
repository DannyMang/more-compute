/** @type {import('next').NextConfig} */
const nextConfig = {
  async rewrites() {
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