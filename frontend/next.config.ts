import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // The app is self-contained in frontend/ (deploy with this folder as the root directory).
  turbopack: { root: path.resolve(__dirname) },
  devIndicators: false,
  // The Status page was folded into Live (service chip) and Operations (revision 6).
  async redirects() {
    return [
      { source: "/status", destination: "/", permanent: false },
      // Busy times was removed (user request, 13 Nov 2026); the planner and station cards keep the answers.
      { source: "/insights", destination: "/", permanent: false },
      // Welcome and About were removed (user request, 13 Nov 2026).
      { source: "/welcome", destination: "/", permanent: false },
      { source: "/about", destination: "/", permanent: false },
      { source: "/control/analytics", destination: "/control#trends", permanent: false },
    ];
  },
};

export default nextConfig;
