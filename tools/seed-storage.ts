#!/usr/bin/env bun
// Populate tools/storage with a variety of files for manual czkawka-web testing.
// Run from anywhere: ./tools/seed-storage.ts (or `bun tools/seed-storage.ts`)

import { mkdir, rm, symlink as fsSymlink } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "storage");
const at = (p: string) => join(ROOT, p);

// ── helpers ─────────────────────────────────────────────────────────────────

const file = (path: string, content: string | Uint8Array) =>
  Bun.write(at(path), content);

const empty = (path: string) => Bun.write(at(path), "");

const dup = async (src: string, dest: string) =>
  Bun.write(at(dest), Bun.file(at(src)));

const dir = (path: string) => mkdir(at(path), { recursive: true });

const symlink = async (target: string, linkPath: string) => {
  await mkdir(dirname(at(linkPath)), { recursive: true });
  await fsSymlink(target, at(linkPath));
};

const randomBlob = (path: string, bytes: number) => {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return Bun.write(at(path), buf);
};

// Pad text up to `min` bytes so czkawka's default 8 KB minimum dup size kicks in.
const padded = (seed: string, min = 16 * 1024) => {
  const block = seed + "\n" + "-".repeat(80) + "\n";
  let out = seed + "\n\n";
  while (out.length < min) out += block;
  return out;
};

const bytes = (path: string, hex: string, suffix = "") => {
  const head = new Uint8Array(hex.match(/../g)!.map((b) => parseInt(b, 16)));
  const tail = new TextEncoder().encode(suffix);
  const out = new Uint8Array(head.length + tail.length);
  out.set(head, 0);
  out.set(tail, head.length);
  return Bun.write(at(path), out);
};

// ── seed ────────────────────────────────────────────────────────────────────

console.log(`Seeding ${ROOT}`);
await rm(ROOT, { recursive: true, force: true });
await dir(".");

// Exact duplicates across directories (hash-method dups).
// Files are padded above czkawka's default 8 KB minimum.
await file("media-library/docs/report.pdf", padded("Quarterly report — confidential"));
await dup ("media-library/docs/report.pdf", "media-library/docs/report-copy.pdf");
await dup ("media-library/docs/report.pdf", "media-library/archive/report.pdf");

// A second duplicate set, three copies sprinkled around.
await file("media-library/docs/notes.txt", padded("Meeting notes 2024-09-12. Action items: 1, 2, 3."));
await dup ("media-library/docs/notes.txt", "media-library/archive/notes-backup.txt");
await dup ("media-library/docs/notes.txt", "downloads/notes.txt");

// Same name, different content (name-method dups; not hash dups).
await file("downloads/projects/alpha/readme.md", padded("alpha v1"));
await file("downloads/projects/beta/readme.md",  padded("beta build configuration"));
await file("downloads/projects/readme.md",       padded("another readme entirely"));

// Same size, different content (size-method dups; not hash dups).
// Each is exactly 16 KB but byte-different.
const sameSize = 16 * 1024;
await file("downloads/same-size/a.dat", "A".repeat(sameSize));
await file("downloads/same-size/b.dat", "B".repeat(sameSize));
await file("downloads/same-size/c.dat", "C".repeat(sameSize));

// Empty files.
await empty("downloads/empties/empty1.log");
await empty("downloads/empties/empty2.log");
await empty("downloads/empty.txt");
await empty("media-library/.placeholder"); // hidden — browser hides dotfiles

// Empty folders.
await dir("media-library/empty-archive");
await dir("downloads/temp/old-cache");
await dir("downloads/projects/gamma");

// Temporary files (czkawka's "temp" scan looks for ~/.tmp/.bak/etc.).
await file("downloads/work/draft.txt~", "scratch work");
await file("downloads/work/draft.bak",  "old version");
await file("downloads/work/build.tmp",  "tmp cache");

// Bigger files for the "biggest files" scan. Random so they don't collapse to dups.
await randomBlob("downloads/big/blob-2mb.dat",   2 * 1024 * 1024);
await randomBlob("downloads/big/blob-5mb.dat",   5 * 1024 * 1024);
await randomBlob("downloads/big/blob-512k.dat",  512 * 1024);

// Bad extensions — file content doesn't match the extension. Czkawka detects by content.
await bytes("downloads/mislabeled/photo.txt",   "89504E470D0A1A0A", "fake-png-body-bytes"); // PNG
await file ("downloads/mislabeled/archive.zip", "this is just plain text");
await bytes("downloads/mislabeled/scan.pdf",    "FFD8FFE00010", "JFIFstub");                 // JPEG

// Broken / invalid symlinks.
await symlink("/this/path/does/not/exist",            "downloads/links/dangling");
await symlink("../../media-library/docs/report.pdf",  "downloads/links/valid-relative");
await symlink("./loop",                                "downloads/links/loop");

// Nested mix to give the directory browser something to walk through.
await dir("media-library/photos/2024/holiday");
await dir("media-library/photos/2024/work");
await file("media-library/photos/2024/index.txt", "metadata only");
await file("media-library/photos/2023/index.txt", "metadata only"); // duplicates the above

console.log("Done.");
