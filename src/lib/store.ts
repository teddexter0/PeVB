import fs from "fs";
import path from "path";
import os from "os";
import { Digest } from "./gemini";

// Use OS temp dir — works on both Windows and Linux/Vercel
const DIGEST_PATH = path.join(os.tmpdir(), "pvb_digest.json");

export function saveDigest(digest: Digest): void {
  fs.writeFileSync(DIGEST_PATH, JSON.stringify(digest, null, 2), "utf-8");
}

export function loadDigest(): Digest | null {
  try {
    if (!fs.existsSync(DIGEST_PATH)) return null;
    const raw = fs.readFileSync(DIGEST_PATH, "utf-8");
    return JSON.parse(raw) as Digest;
  } catch {
    return null;
  }
}