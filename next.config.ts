import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "export",
  basePath: "/atsrating",
  images: { unoptimized: true },
};

export default nextConfig;
