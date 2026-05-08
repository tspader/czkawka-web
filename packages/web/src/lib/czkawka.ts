import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { DuplicatesHashResult, DuplicatesNameResult, DuplicatesSizeNameResult, DuplicateEntry } from "@czkawka/core";

const CZKAWKA_BIN = process.env.CZKAWKA_BIN ?? "czkawka_cli";

const Rc = {
  Ok: 0,
  GotResults: 11,
} as const;

type Comparator = "hash" | "name" | "size" | "size_name";

interface ScanOptions {
  dirs: string[];
  excludeDirs?: string[];
  minSize?: number;
  comparator: Comparator;
}

///////////
// STATE //
///////////
export interface ScanEntry {
  path: string;
  size: number;
  mtime: number;
}

export interface ScanGroup {
  ids: string[];
  keeperIdx: number;
}

export interface ScanState {
  id: string;
  comparator: Comparator;
  entries: Map<string, ScanEntry>;
  groups: Map<string, ScanGroup>;
  scanDirs: string[];
}

let currentScan: ScanState | null = null;

/////////
// JOB //
/////////
export interface ProgressEvent {
  event: "progress";
  tool: string;
  stage: string;
  checking_method: string;
  current_stage_idx: number;
  max_stage_idx: number;
  entries_checked: number;
  entries_to_check: number;
  bytes_checked: number;
  bytes_to_check: number;
}

type JobStatus = "running" | "completed" | "failed" | "cancelled";

interface Job {
  startedAt: number;
  status: JobStatus;
  progress?: ProgressEvent;
  stderrTail: string[];
  error?: string;
  proc: ReturnType<typeof Bun.spawn>;
  tmpFile: string;
  opts: ScanOptions;
}

let activeJob: Job | null = null;

export type Status =
  { kind: "idle" } |
  { kind: "running"; elapsed: number; message: string; progress?: ProgressEvent } |
  { kind: "completed"; scan: ScanState } |
  { kind: "cancelled" } |
  { kind: "failed"; error: string };

export function status(): Status {
  const job = activeJob;
  if (!job) {
    return { kind: "idle" };
  }

  switch (job.status) {
    case "running":
      return {
        kind: "running",
        elapsed: Math.floor((Date.now() - job.startedAt) / 1000),
        message: job.stderrTail.at(-1) ?? "Working…",
        progress: job.progress,
      };
    case "completed":
      return { kind: "completed", scan: currentScan! };
    case "cancelled":
      return { kind: "cancelled" };
    case "failed":
      return { kind: "failed", error: job.error ?? "unknown error" };
  }
}

export function lookup(scanId: string): ScanState | null {
  return currentScan?.id === scanId ? currentScan : null;
}

export function setKeeper(scanId: string, gid: string, keepId: string): ScanGroup | null {
  const scan = lookup(scanId);
  if (!scan) return null;
  const group = scan.groups.get(gid);
  if (!group) return null;
  const idx = group.ids.indexOf(keepId);
  if (idx < 0) return null;
  group.keeperIdx = idx;
  memoCache.delete(scan);
  return group;
}

export function removeEntries(scanId: string, ids: Iterable<string>): { affectedGids: Set<string> } {
  const affectedGids = new Set<string>();
  const scan = lookup(scanId);
  if (!scan) return { affectedGids };

  const idToGid = new Map<string, string>();
  for (const [gid, group] of scan.groups) {
    for (const id of group.ids) idToGid.set(id, gid);
  }

  for (const id of ids) {
    const gid = idToGid.get(id);
    if (!gid) continue;
    const group = scan.groups.get(gid);
    if (!group) continue;

    const removedIdx = group.ids.indexOf(id);
    if (removedIdx < 0) continue;
    const wasKeeper = removedIdx === group.keeperIdx;

    group.ids.splice(removedIdx, 1);
    scan.entries.delete(id);
    affectedGids.add(gid);

    if (group.ids.length < 2) {
      scan.groups.delete(gid);
      continue;
    }
    if (wasKeeper) {
      group.keeperIdx = pickKeeperIdx(group.ids.map((rid) => scan.entries.get(rid)!), scan.scanDirs);
    } else if (removedIdx < group.keeperIdx) {
      group.keeperIdx--;
    }
  }

  if (affectedGids.size > 0) memoCache.delete(scan);
  return { affectedGids };
}

// We must pick a file to be the canonical copy. For hard links, this doesn't really matter, but
// for deletion it ought to be easy to specify which file wins by default. This file is caller the
// "keeper". This is our heuristic:
//
// 1) Use the ordering of the directories we're scanning as priority
// 2) If that ties, use the shortest path
// 3) If that ties, use mtime
function pickKeeperIdx(
  files: { path: string; mtime: number }[],
  priorityDirs: string[] = [],
): number {
  const norm = priorityDirs.map((d) => (d.endsWith("/") ? d.slice(0, -1) : d));
  const priorityOf = (p: string): number => {
    for (let i = 0; i < norm.length; i++) {
      const d = norm[i]!;
      if (p === d || p.startsWith(d + "/")) return i;
    }
    return Infinity;
  };

  let p = {
    best: priorityOf(files[0]!.path),
    current: 0
  };

  let best = 0;
  for (let it = 1; it < files.length; it++) {
    const a = files[best]!;
    const b = files[it]!;

    p.current = priorityOf(b.path);
    if (p.current !== p.best) {
      if (p.current < p.best) {
        best = it;
        p.best = p.current;
      }
      continue;
    }
    const da = a.path.split("/").length, db = b.path.split("/").length;
    if (db < da || (db === da && b.mtime < a.mtime)) {
      best = it;
    }
  }
  return best;
}

const memoCache = new WeakMap<ScanState, Map<string, unknown>>();
export function memo<T>(scan: ScanState, key: string, build: () => T): T {
  let m = memoCache.get(scan);
  if (!m) { m = new Map(); memoCache.set(scan, m); }
  if (!m.has(key)) m.set(key, build());
  return m.get(key) as T;
}

export function start(opts: ScanOptions): void {
  if (activeJob && activeJob.status === "running") {
    throw new Error("A scan is already running. Wait for it to finish or cancel it.");
  }

  const tmpFile = path.join(os.tmpdir(), `czkawka-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);

  const args: string[] = ["dup", "-s", opts.comparator];
  for (const d of opts.dirs) {
    args.push("-d", d);
  }
  for (const d of opts.excludeDirs ?? []) {
    args.push("-e", d);
  }
  if (opts.minSize != null) {
    args.push("-m", String(opts.minSize));
  }
  args.push("--compact-file-to-save", tmpFile);

  const proc = Bun.spawn([CZKAWKA_BIN, ...args], {
    stdout: "ignore",
    stderr: "pipe",
    // Set the environment our patched CLI uses to know to emit progress as JSON
    env: {
      ...process.env,
      CZKAWKA_JSON_PROGRESS: "1",
      CZKAWKA_PROGRESS_INTERVAL_MS: process.env.CZKAWKA_PROGRESS_INTERVAL_MS ?? "250",
    },
  });

  const job: Job = {
    opts,
    proc,
    tmpFile,
    startedAt: Date.now(),
    status: "running",
    stderrTail: [],
  };
  activeJob = job;

  const watchOutput = async () => {
    const decoder = new TextDecoder();
    let buf = "";
    for await (const chunk of proc.stderr as ReadableStream<Uint8Array>) {
      buf += decoder.decode(chunk, { stream: true });
      let nl: number;
      while ((nl = buf.indexOf("\n")) !== -1) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;

        // If it parses as JSON, consume it. Otherwise, buffer it.
        try {
          const ev = JSON.parse(line) as ProgressEvent;
          if (ev.event === "progress") {
            job.progress = ev;
            continue;
          }
        } catch {}

        job.stderrTail.push(line);
        if (job.stderrTail.length > 50) job.stderrTail.shift();
      }
    }
    if (buf.trim()) job.stderrTail.push(buf.trim());
  };
  watchOutput().catch((e) => console.error("Error while watching output: ", e));

  // Watch for completion. If the user cancelled mid-scan, leave the status alone.
  const watchCompletion = async () => {
    const exitCode = await proc.exited;
    try {
      if (job.status === "cancelled") return;

      if (exitCode !== Rc.Ok && exitCode !== Rc.GotResults) {
        job.status = "failed";
        job.error = `czkawka exited ${exitCode}: ${job.stderrTail.slice(-3).join(" • ") || "(no output)"}`;
      } else {
        const raw = JSON.parse(await fs.promises.readFile(tmpFile, "utf8"));
        await processScan(opts.comparator, raw, opts.dirs);
        job.status = "completed";
      }

    } catch (err) {
      job.status = "failed";
      job.error = (err as Error).message;
    } finally {
      await fs.promises.rm(tmpFile, { force: true });
    }
  };
  watchCompletion().catch((e) => console.error('Error while watching completion: ', e));
}

export function cancel(): boolean {
  if (!activeJob || activeJob.status !== "running") return false;

  activeJob.status = "cancelled";
  const proc = activeJob.proc;

  const kill = (signal: NodeJS.Signals) => { try { proc.kill(signal) } catch {} }

  kill("SIGTERM")

  // Defensively nuke the subprocess after half a second to be sure
  setTimeout(() => {
    if (proc.exitCode !== null) return;
    kill("SIGKILL")
  }, 500)

  return true;
}


// czkawka's check_files_size() filters out files that share an inode (hardlinks
// of one another) before reporting duplicates, but check_files_name() and
// check_files_size_name() don't — so Name and Name+Size will list hardlinked
// pairs as if they were distinct copies. We do the same dedupe here so all
// comparators behave consistently. For Hash/Size this is a no-op.
async function dropHardlinks(groups: DuplicateEntry[][]): Promise<DuplicateEntry[][]> {
  const out: DuplicateEntry[][] = [];
  for (const group of groups) {
    const keys = await Promise.all(group.map(async (e) => {
      try {
        const s = await fs.promises.stat(e.path, { bigint: true });
        return `${s.dev}:${s.ino}`;
      } catch {
        return null;
      }
    }));
    const seen = new Set<string>();
    const kept: DuplicateEntry[] = [];
    for (let i = 0; i < group.length; i++) {
      const k = keys[i];
      if (k === null) continue;
      if (seen.has(k)) continue;
      seen.add(k);
      kept.push(group[i]!);
    }
    if (kept.length > 1) out.push(kept);
  }
  return out;
}

async function processScan(comparator: Comparator, raw: unknown, scanDirs: string[]): Promise<void> {
  let rawGroups: DuplicateEntry[][];
  switch (comparator) {
    case "hash":      rawGroups = Object.values(DuplicatesHashResult.parse(raw)).flat(); break;
    case "name":
    case "size":      rawGroups = Object.values(DuplicatesNameResult.parse(raw));        break;
    case "size_name": rawGroups = DuplicatesSizeNameResult.parse(raw);                   break;
  }

  const filteredGroups = await dropHardlinks(rawGroups);

  const entries = new Map<string, ScanEntry>();
  const groups = new Map<string, ScanGroup>();
  let nextId = 0;
  let nextGroupId = 0;

  for (const group of filteredGroups) {
    const gid = `g${nextGroupId++}`;
    const ids: string[] = [];
    for (const e of group) {
      const id = `e${nextId++}`;
      entries.set(id, { path: e.path, size: e.size, mtime: e.modified_date });
      ids.push(id);
    }
    const keeperIdx = ids.length <= 1
      ? 0
      : pickKeeperIdx(ids.map((id) => entries.get(id)!), scanDirs);
    groups.set(gid, { ids, keeperIdx });
  }

  currentScan = {
    id: `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    comparator,
    entries,
    groups,
    scanDirs,
  };
}

export * as Czkawka from "./czkawka";
