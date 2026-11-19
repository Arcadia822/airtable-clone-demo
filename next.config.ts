import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1"],
  reactCompiler: true,
  serverExternalPackages: ["@electric-sql/pglite"],
};

export default nextConfig;
