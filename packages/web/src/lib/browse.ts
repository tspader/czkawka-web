import * as path from "path";

export const BROWSE_ROOT = path.resolve(process.env.BROWSE_ROOT ?? "/");

export function safeBrowsePath(input: string): string {
  const resolved = path.resolve(input || BROWSE_ROOT);
  const rel = path.relative(BROWSE_ROOT, resolved);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error(`path outside BROWSE_ROOT (${BROWSE_ROOT})`);
  }
  return resolved;
}
