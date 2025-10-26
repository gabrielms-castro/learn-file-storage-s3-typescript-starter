import { existsSync, mkdirSync } from "fs";

import type { ApiConfig } from "../config";
import path from "path";

export const allowedTypes = [
  "image/jpg",
  "image/png",
]

export function ensureAssetsDir(cfg: ApiConfig) {
  if (!existsSync(cfg.assetsRoot)) {
    mkdirSync(cfg.assetsRoot, { recursive: true });
  }
}

export function mediaTypeToExtension(mediaType: string) {
  const parts = mediaType.split("/")
  if (parts.length !== 2) {
    return ".bin"
  }
  return "." + parts[1];
}
