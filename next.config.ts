import type { NextConfig } from "next";
import os from "node:os";

const localIpv4Addresses = Object.values(os.networkInterfaces())
  .flatMap((entries) => entries || [])
  .filter((entry) => entry.family === "IPv4")
  .map((entry) => entry.address);

const nextConfig: NextConfig = {
  serverExternalPackages: ["ffmpeg-static"],
  allowedDevOrigins: Array.from(
    new Set(["127.0.0.1", "localhost", ...localIpv4Addresses]),
  ),
};

export default nextConfig;
