import * as fs from "fs";
import { Czkawka, type ScanEntry, type ScanGroup, type ScanState } from "./czkawka";

interface ResolvedTarget {
  id: string;
  entry: ScanEntry;
}

export type ActionResult =
  { ok: true } |
  { ok: false; error: string };

type CheckedTarget =
  { id: string; entry: ScanEntry; ready: true } |
  { id: string; error: string; ready: false };

function resolveGroup(scanId: string, gid: string): { scan: ScanState; group: ScanGroup; keepId: string; dupIds: string[] } {
  const scan = Czkawka.lookup(scanId);
  if (!scan) {
    throw new Error("Results are stale — re-run the scan.");
  }

  const group = scan.groups.get(gid);
  if (!group) {
    throw new Error(`Unknown group: ${gid}`);
  }

  const keepId = group.ids[group.keeperIdx]!;
  const dupIds = group.ids.filter((_, index) => index !== group.keeperIdx);
  return { scan, group, keepId, dupIds };
}

// My Unraid filesystem returns inodes with huge IDs. I didn't look too much into why, but it's
// easy to just use BigInt for filesystem ops.
const statBig  = (p: string): fs.BigIntStats => fs.statSync(p,  { bigint: true });
const lstatBig = (p: string): fs.BigIntStats => fs.lstatSync(p, { bigint: true });

function resolveIds(scanId: string, ids: string[]): ResolvedTarget[] {
  const scan = Czkawka.lookup(scanId);
  if (!scan) throw new Error("Results are stale — re-run the scan.");

  const out: ResolvedTarget[] = [];
  for (const id of ids) {
    const entry = scan.entries.get(id);
    if (!entry) throw new Error(`Unknown entry id: ${id}`);
    out.push({ id, entry });
  }
  return out;
}

function staleReason(entry: ScanEntry): string | null {
  let st: fs.Stats;
  try {
    st = fs.statSync(entry.path);
  } catch (err) {
    return `not found: ${(err as Error).message}`;
  }
  if (st.size !== entry.size && entry.size > 0) return `size changed (${entry.size} → ${st.size})`;

  // We're not trying to be ultraprecise, so allow 2 seconds from various forms of mtime slop
  const recorded = entry.mtime;
  const onDisk = Math.floor(st.mtimeMs / 1000);
  if (recorded > 0 && Math.abs(recorded - onDisk) > 2) {
    return `modified since scan`;
  }
  return null;
}

function checkStale(targets: ResolvedTarget[]): CheckedTarget[] {
  return targets.map(({ id, entry }) => {
    const reason = staleReason(entry);
    return reason
      ? { id, ready: false, error: reason }
      : { id, entry, ready: true };
  });
}

function runChecked(
  checked: CheckedTarget[],
  perform: (entry: ScanEntry) => ActionResult,
): Record<string, ActionResult> {
  const out: Record<string, ActionResult> = {};
  for (const t of checked) {
    out[t.id] = t.ready ? perform(t.entry) : { ok: false, error: t.error };
  }
  return out;
}

function commitRemovals(scanId: string, results: Record<string, ActionResult>): void {
  const succeeded: string[] = [];
  for (const [id, r] of Object.entries(results)) {
    if (r.ok) succeeded.push(id);
  }
  if (succeeded.length > 0) Czkawka.removeEntries(scanId, succeeded);
}

export function deleteIds(scanId: string, ids: string[]): Record<string, ActionResult> {
  const checked = checkStale(resolveIds(scanId, ids));
  const results = runChecked(checked, (entry) => {
    try {
      fs.unlinkSync(entry.path);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  });
  commitRemovals(scanId, results);
  return results;
}

// Atomically replace a dupe with a link to a keep
function replaceWithLink(
  keepPath: string,
  dupPath: string,
  kind: "hard" | "sym",
  keepStat: fs.BigIntStats,
): ActionResult {
  let dupStat: fs.BigIntStats;
  try {
    dupStat = lstatBig(dupPath);
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }

  if (kind === "hard") {
    if (dupStat.dev !== keepStat.dev) return { ok: false, error: "different filesystem from keep target" };
    if (dupStat.ino === keepStat.ino) return { ok: true };
  } else if (dupStat.isSymbolicLink()) {
    return { ok: true };
  }

  // We need to atomically replace the duped path with a link to the keep path. This is
  // made a little more complicated by the fact that media servers usually have several
  // disks, weird striping or vdevs, mount points, whatever, and rename() is only
  // atomic within the same filesystem.
  //
  // We make a temporary file next to the dupe path, so that it's on the same filesystem,
  // and then atomically swap in the dupe path with this link.
  const tmp = `${dupPath}.czkawka-tmp-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
  try {
    if (kind === "hard") {
      fs.linkSync(keepPath, tmp);
    }
    else {
      fs.symlinkSync(keepPath, tmp);
    }
    fs.renameSync(tmp, dupPath);
    return { ok: true };
  } catch (err) {
    fs.rmSync(tmp, { force: true });
    return { ok: false, error: (err as Error).message };
  }
}

function linkIds(
  scanId: string,
  keepId: string,
  dupIds: string[],
  kind: "hard" | "sym",
): Record<string, ActionResult> {
  if (dupIds.length < 1) {
    throw new Error(`${kind}link needs at least one duplicate to replace`);
  }
  const [keep] = resolveIds(scanId, [keepId]);
  if (!keep) throw new Error("missing keep target");
  const dups = resolveIds(scanId, dupIds);

  const keepStale = staleReason(keep.entry);
  if (keepStale) throw new Error(`keep target ${keepStale}`);

  let keepStat: fs.BigIntStats;
  try {
    keepStat = statBig(keep.entry.path);
  } catch (err) {
    throw new Error(`keep target unreadable: ${(err as Error).message}`);
  }

  const checked = checkStale(dups);
  const results: Record<string, ActionResult> = {
    [keep.id]: { ok: true },
    ...runChecked(checked, (entry) => replaceWithLink(keep.entry.path, entry.path, kind, keepStat)),
  };
  const dupResults: Record<string, ActionResult> = { ...results };
  delete dupResults[keep.id];
  commitRemovals(scanId, dupResults);
  return results;
}

export function hardlinkGroup(scanId: string, gid: string) {
  const { keepId, dupIds } = resolveGroup(scanId, gid);
  return linkIds(scanId, keepId, dupIds, "hard");
}

export function symlinkGroup(scanId: string, gid: string) {
  const { keepId, dupIds } = resolveGroup(scanId, gid);
  return linkIds(scanId, keepId, dupIds, "sym");
}

export function deleteExtrasGroup(scanId: string, gid: string) {
  const { dupIds } = resolveGroup(scanId, gid);
  return deleteIds(scanId, dupIds);
}

export function deleteGroup(scanId: string, gid: string) {
  const { group } = resolveGroup(scanId, gid);
  return deleteIds(scanId, group.ids);
}

export interface BulkSummary {
  totalGroups: number;
  filesAttempted: number;
  succeeded: number;
  failed: number;
  errors: Array<{ path: string; error: string }>;
}

function emptySummary(): BulkSummary {
  return { totalGroups: 0, filesAttempted: 0, succeeded: 0, failed: 0, errors: [] };
}

function applyToAllGroups(
  scanId: string,
  perGroup: (group: { keepId: string; dupIds: string[]; allIds: string[] }) => Record<string, ActionResult>,
): BulkSummary {
  const scan = Czkawka.lookup(scanId);
  if (!scan) throw new Error("Results are stale — re-run the scan.");

  const work = Array.from(scan.groups.values()).map((g) => ({
    ids: g.ids.slice(),
    keeperIdx: g.keeperIdx,
  }));

  const summary = emptySummary();
  for (const { ids, keeperIdx } of work) {
    if (ids.length < 2) continue;
    summary.totalGroups++;
    const keepId = ids[keeperIdx]!;
    const dupIds = ids.filter((_, i) => i !== keeperIdx);
    const results = perGroup({ keepId, dupIds, allIds: ids });
    for (const [id, r] of Object.entries(results)) {
      summary.filesAttempted++;
      if (r.ok) summary.succeeded++;
      else {
        summary.failed++;
        const entry = scan.entries.get(id);
        summary.errors.push({ path: entry?.path ?? id, error: r.error });
      }
    }
  }
  return summary;
}

export function hardlinkAllGroups(scanId: string) {
  return applyToAllGroups(scanId, ({ keepId, dupIds }) => linkIds(scanId, keepId, dupIds, "hard"));
}

export function symlinkAllGroups(scanId: string) {
  return applyToAllGroups(scanId, ({ keepId, dupIds }) => linkIds(scanId, keepId, dupIds, "sym"));
}

export function deleteGroupExtras(scanId: string) {
  return applyToAllGroups(scanId, ({ dupIds }) => deleteIds(scanId, dupIds));
}
