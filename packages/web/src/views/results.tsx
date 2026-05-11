import { Czkawka, type ProgressEvent, type ScanEntry, type ScanState } from "../lib/czkawka";
import type { SortMode } from "../lib/api";
export type { SortMode };


export function ScanProgress({
  elapsed, message, progress,
}: { elapsed: number; message: string; progress?: ProgressEvent }) {
  return (
    <div id="scan-status" class="scan-progress">
      <div class="scan-progress-row">
        <span class="scan-spinner" aria-hidden="true" />
        <span class="scan-progress-label">Scanning…</span>
        <button
          class="btn-cancel"
          hx-post="/scan/cancel"
          hx-target="#scan-status"
          hx-swap="outerHTML"
          hx-sync="#scan-progress-poll:replace"
          hx-disabled-elt="this"
        >
          Cancel
        </button>
      </div>
      <div
        id="scan-progress-poll"
        hx-get="/scan/status"
        hx-trigger="every 250ms"
        hx-target="this"
        hx-swap="innerHTML"
      >
        <ScanProgressContent elapsed={elapsed} message={message} progress={progress} />
      </div>
    </div>
  );
}

export function ScanProgressContent({
  elapsed, message, progress,
}: { elapsed: number; message: string; progress?: ProgressEvent }) {
  return (
    <>
      <div class="scan-progress-elapsed">{fmtElapsed(elapsed)} elapsed</div>
      {progress
        ? <ProgressDetail progress={progress} />
        : <div class="scan-progress-message">{message}</div>}
    </>
  );
}

function ProgressDetail({ progress }: { progress: ProgressEvent }) {
  const hasEntryTotal = progress.entries_to_check > 0;
  const hasByteTotal = progress.bytes_to_check > 0;
  const showEntries = hasEntryTotal || progress.entries_checked > 0;
  const showBytes = hasByteTotal || progress.bytes_checked > 0;

  const entries = hasEntryTotal
    ? (progress.entries_checked / progress.entries_to_check) * 100
    : null;
  const bytes = hasByteTotal
    ? (progress.bytes_checked / progress.bytes_to_check) * 100
    : null;
  const bar = bytes ?? entries;

  const Stage = ({ current, max, name }: { current: number, max: number, name: string}) => (
    <div class="scan-progress-stage">
      Stage {current} / {max}: {name}
    </div>
  )

  const ProgressBar = ({ percent }: { percent: number | null }) => {
    if (percent == null) {
      return <div id="scan-progress-bar" hx-preserve="true" class="scan-progress-bar scan-progress-bar-indeterminate" />
    }

    return (
      <div class="scan-progress-bar">
        <div class="scan-progress-bar-fill" style={`width:${percent.toFixed(1)}%`} />
      </div>
    )
  }

  return (
    <>
      <Stage current={progress.current_stage_idx} max={progress.max_stage_idx} name={prettyStage(progress.stage)}/>
      <ProgressBar percent={bar} />
      <div class="scan-progress-counts">
        {showEntries && (
          <span>
            {progress.entries_checked.toLocaleString()}
            {hasEntryTotal ? ` / ${progress.entries_to_check.toLocaleString()}` : ""}
            {" files"}
            {entries != null ? ` (${entries.toFixed(1)}%)` : ""}
          </span>
        )}
        {showBytes && (
          <span>
            {fmtSize(progress.bytes_checked)}
            {hasByteTotal ? ` / ${fmtSize(progress.bytes_to_check)}` : ""}
            {bytes != null ? ` (${bytes.toFixed(1)}%)` : ""}
          </span>
        )}
      </div>
    </>
  );
}

const prettyStage = (stage: string): string => {
  let s = stage.startsWith("Duplicate") ? stage.slice("Duplicate".length) : stage;
  if (!s) s = stage;
  s = s.replace(/([a-z])([A-Z])/g, "$1 $2");
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

interface GroupView {
  gid: string;
  files: (ScanEntry & { id: string })[];
  // Index into `files` of the heuristic-picked default keeper. Source of
  // truth lives in ScanState (czkawka.ts).
  keeperIdx: number;
  // If all entries have the same size, this is non-null
  uniformSize: number | null;
  maxSize: number;
  recoverable: number;
  latestMtime: number;
  prefixDir: string;
}

export function buildGroupView(scan: ScanState, gid: string, ids: string[], keeperIdx: number): GroupView {
  const files = ids.map((id) => ({ id, ...scan.entries.get(id)! }));
  const keeper = files[keeperIdx]!;
  let totalSize = 0;
  let maxSize = 0;
  let latestMtime = 0;
  let allSame = true;
  for (const f of files) {
    totalSize += f.size;
    if (f.size > maxSize) maxSize = f.size;
    if (f.mtime > latestMtime) latestMtime = f.mtime;
    if (f.size !== keeper.size) allSame = false;
  }
  return {
    gid,
    files,
    keeperIdx,
    uniformSize: allSame ? keeper.size : null,
    maxSize,
    recoverable: totalSize - keeper.size,
    latestMtime,
    prefixDir: commonDirPrefix(files.map((f) => f.path)),
  };
}

// Longest common directory prefix across paths in a group, ending with "/".
// We only fold whole directory components, so we never split a name like
// "Inception" and "Inception (2010)" mid-token.
function commonDirPrefix(paths: string[]): string {
  if (paths.length < 2) return "";
  const split = paths.map((p) => p.split("/"));
  const minLen = Math.min(...split.map((p) => p.length));
  let i = 0;
  while (i < minLen - 1 && split.every((p) => p[i] === split[0]![i])) i++;
  return split[0]!.slice(0, i).join("/") + (i > 0 ? "/" : "");
}

// Page size for incremental rendering. Big scans (especially "size" mode on a
// noisy filesystem) produce thousands of groups; rendering them all in one
// shot freezes the browser parsing/laying-out the resulting HTML, which made
// the cancel button look broken (it was actually fine — the main thread was
// just busy). With paging, the initial response is bounded and subsequent
// pages load on demand via /results/page.
const PAGE_SIZE = 20;

const SORT_LABELS: Record<SortMode, string> = {
  "group-size": "Group size",
  "file-size":  "File size",
  "path":       "Path",
  "mtime":      "Most recent in group",
};

// Comparators for each sort mode. All sort descending except "path" (asc).
const SORT_CMP: Record<SortMode, (a: GroupView, b: GroupView) => number> = {
  "group-size": (a, b) => b.recoverable - a.recoverable,
  "file-size":  (a, b) => b.maxSize - a.maxSize,
  "path":       (a, b) => a.files[a.keeperIdx]!.path.localeCompare(b.files[b.keeperIdx]!.path),
  "mtime":      (a, b) => b.latestMtime - a.latestMtime,
};

// Memoize the unsorted group views and each sorted ordering. Without this,
// every /results/page request rebuilt every GroupView (path-prefix scan,
// keeper pick, multiple reduces) and resorted the whole list — each
// Load-more click was O(N) work. With caching, the first page on a given
// sort pays O(N log N) once; every subsequent click on that sort is
// O(PAGE_SIZE). The cache lifecycle (WeakMap keyed on ScanState, GC'd when
// a new scan replaces the active one) lives in czkawka.ts.
function buildAllGroups(scan: ScanState): GroupView[] {
  return Czkawka.memo(scan, "groups", () =>
    Array.from(scan.groups.entries())
      .map(([gid, g]) => buildGroupView(scan, gid, g.ids, g.keeperIdx))
      .filter((g) => g.files.length >= 2),
  );
}

export function getSortedGroups(scan: ScanState, sort: SortMode): GroupView[] {
  // Shallow-copy the unsorted views so we never mutate the cache.
  return Czkawka.memo(scan, `sorted:${sort}`, () =>
    [...buildAllGroups(scan)].sort(SORT_CMP[sort]),
  );
}

export function ScanResults({ scan }: { scan: ScanState }) {
  const allGroups = buildAllGroups(scan);

  if (allGroups.length === 0) {
    return <div class="dup-empty">No duplicates found.</div>;
  }

  const sorted = getSortedGroups(scan, "group-size");

  return (
    <div id="dup-results-root" class="dup-results" data-scan-id={scan.id}>
      <DupSummary scan={scan} />
      <div id="dup-groups" class="dup-groups">
        <GroupsPage scanId={scan.id} groups={sorted} offset={0} sort="group-size" />
      </div>
      <script dangerouslySetInnerHTML={{ __html: RESULTS_JS }} />
    </div>
  );
}

// Renders a slice of groups + an optional "Load more" button that
// outerHTML-swaps itself with the next slice when clicked. Also used as the
// response of /results/page for sort changes (offset=0) and Load more clicks.
export function GroupsPage({ scanId, groups, offset, sort }: {
  scanId: string;
  groups: GroupView[];
  offset: number;
  sort: SortMode;
}) {
  const slice = groups.slice(offset, offset + PAGE_SIZE);
  const nextOffset = offset + slice.length;
  const remaining = groups.length - nextOffset;
  return (
    <>
      {slice.map((g) => <GroupCard scanId={scanId} group={g} />)}
      {remaining > 0 ? (
        <button
          id="load-more"
          class="btn-load-more"
          hx-get="/results/page"
          hx-vals={JSON.stringify({ scanId, offset: nextOffset, sort })}
          hx-target="#load-more"
          hx-swap="outerHTML"
        >
          Load {Math.min(PAGE_SIZE, remaining)} more
          <span class="btn-load-more-meta">
            ({nextOffset.toLocaleString()} of {groups.length.toLocaleString()} loaded)
          </span>
        </button>
      ) : null}
    </>
  );
}

export function DupSummary({ scan, oob }: { scan: ScanState; oob?: boolean }) {
  const allGroups = buildAllGroups(scan);
  const totalRecoverable = allGroups.reduce((s, g) => s + g.recoverable, 0);
  const totalFiles = allGroups.reduce((s, g) => s + g.files.length, 0);
  const scanId = scan.id;
  return (
    <div id="dup-summary" class="dup-summary" hx-swap-oob={oob ? "outerHTML" : undefined}>
      <div>
        <div class="dup-summary-recoverable">{fmtSize(totalRecoverable)}</div>
        <div class="dup-summary-label">recoverable across {allGroups.length} groups · {totalFiles} files</div>
      </div>
      <div class="dup-summary-actions">
        <span class="sort-label">Sort</span>
        <select
          name="sort"
          class="sort-select"
          hx-get="/results/page"
          hx-trigger="change"
          hx-target="#dup-groups"
          hx-swap="innerHTML"
          hx-vals={JSON.stringify({ scanId, offset: 0 })}
        >
          {(Object.keys(SORT_LABELS) as SortMode[]).map((k) => (
            <option value={k}>{SORT_LABELS[k]}</option>
          ))}
        </select>
        <button
          class="btn-bulk-hardlink"
          hx-post="/actions/bulk/hardlink"
          hx-vals={JSON.stringify({ scanId })}
          hx-confirm="Hardlink every duplicate to the kept file in its group?"
          hx-target="#dup-results-root"
          hx-swap="outerHTML"
        >
          Hardlink
        </button>
        <button
          class="btn-bulk-danger"
          hx-post="/actions/bulk/delete-extras"
          hx-vals={JSON.stringify({ scanId })}
          hx-confirm="Delete every duplicate except the kept file in its group? This cannot be undone."
          hx-target="#dup-results-root"
          hx-swap="outerHTML"
        >
          Delete extras
        </button>
      </div>
    </div>
  );
}

export function GroupCard({ scanId, group }: { scanId: string; group: GroupView }) {
  const variable = group.uniformSize === null;
  return (
    <section class="dup-group" id={`dup-group-${group.gid}`} data-gid={group.gid}>
      <header class="dup-group-head">
        <div class="dup-group-stats">
          <span class="dup-recoverable">↓ {fmtSize(group.recoverable)}</span>
          <span class="dup-meta">
            {variable ? null : (
              <>
                <span class="dup-size">{fmtSize(group.uniformSize!)}</span>
                <span class="dup-meta-sep">·</span>
              </>
            )}
            <span class="dup-count">{group.files.length} copies</span>
            {variable ? (
              <>
                <span class="dup-meta-sep">·</span>
                <span class="dup-count" style="color:#fbbf24" title="Files in this group have different sizes — review before deleting">sizes vary</span>
              </>
            ) : null}
          </span>
        </div>
        <div class="dup-group-actions">
          <button
            class="btn-primary"
            hx-post="/actions/group/hardlink"
            hx-vals={JSON.stringify({ scanId, gid: group.gid })}
            hx-confirm="Hardlink the duplicates to the kept file?"
            hx-target="closest .dup-group"
            hx-swap="outerHTML"
          >
            Hardlink
          </button>
          <button
            class="btn-danger"
            hx-post="/actions/group/delete-extras"
            hx-vals={JSON.stringify({ scanId, gid: group.gid })}
            hx-confirm="Delete the duplicates? The kept file stays. This cannot be undone."
            hx-target="closest .dup-group"
            hx-swap="outerHTML"
          >
            Delete extras
          </button>
          <details class="more-menu">
            <summary class="btn-ghost" title="More actions">⋯</summary>
            <div class="more-menu-pop">
              <button
                class="more-menu-item"
                hx-post="/actions/group/symlink"
                hx-vals={JSON.stringify({ scanId, gid: group.gid })}
                hx-confirm="Replace each duplicate with a symlink to the kept file?"
                hx-target="closest .dup-group"
                hx-swap="outerHTML"
              >
                Symlink extras to keeper
              </button>
              <button
                class="more-menu-item more-menu-item-danger"
                hx-post="/actions/group/delete-all"
                hx-vals={JSON.stringify({ scanId, gid: group.gid })}
                hx-confirm="Delete every file in this group, including the kept one? This cannot be undone."
                hx-target="closest .dup-group"
                hx-swap="outerHTML"
              >
                Delete entire group
              </button>
            </div>
          </details>
        </div>
      </header>
      <ol class={variable ? "dup-files dup-files-variable" : "dup-files"}>
        {group.files.map((f, i) => {
          const tail = group.prefixDir ? f.path.slice(group.prefixDir.length) : f.path;
          return (
            <li
              class={i === group.keeperIdx ? "dup-file dup-keep" : "dup-file"}
              data-id={f.id}
              title="Click to keep this copy instead"
            >
              <span class="dup-marker">{i === group.keeperIdx ? "keep" : ""}</span>
              {variable ? <span class="dup-row-size">{fmtSize(f.size)}</span> : null}
              <span class="dup-path">
                {group.prefixDir ? <span class="dup-path-dim">{group.prefixDir}</span> : null}
                <span class="dup-path-tail">{tail}</span>
              </span>
              <span class="dup-mtime">{fmtDate(f.mtime)}</span>
              <button
                class="btn-row-del"
                title="Delete this file"
                hx-post="/actions/row/delete"
                hx-vals={JSON.stringify({ scanId, id: f.id })}
                hx-confirm={`Delete ${f.path}?`}
                hx-target="closest .dup-file"
                hx-swap="outerHTML"
              >
                ×
              </button>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

// ── Formatters ───────────────────────────────────────────────────────────────

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

function fmtDate(ts: number): string {
  if (!ts) return "—";
  return new Date(ts * 1000).toLocaleString(undefined, {
    year: "numeric", month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hour12: false,
  });
}

function fmtElapsed(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}m ${s}s`;
}

// ── Client glue ──────────────────────────────────────────────────────────────
// All injected once at first results render. The click delegate is a pure
// dispatcher to /keeper — no DOM mutation here. The server owns which file
// is the keeper; the click is a request to mutate that state, and the
// response is the re-rendered group section that htmx swaps in.
const RESULTS_JS = `
if (!window.__czkawkaClickInstalled) {
  window.__czkawkaClickInstalled = true;
document.addEventListener('click', (e) => {
  const row = e.target.closest('.dup-file');
  if (row && !e.target.closest('button')) {
    const groupSec = row.closest('.dup-group');
    const root = document.getElementById('dup-results-root');
    if (groupSec && root && window.htmx) {
      window.htmx.ajax('POST', '/keeper', {
        target: groupSec,
        swap: 'outerHTML',
        values: {
          scanId: root.dataset.scanId,
          gid: groupSec.dataset.gid,
          keepId: row.dataset.id,
        },
      });
    }
  }
  // Close any open ⋯ menus when clicking outside them.
  document.querySelectorAll('details.more-menu[open]').forEach((d) => {
    if (!d.contains(e.target)) d.removeAttribute('open');
  });
});
}
`.trim();
