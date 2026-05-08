import { Hono, type Context } from "hono";
import { logger } from "hono/logger";
import * as fs from "fs";
import htmxPath from "htmx.org/dist/htmx.min.js" with { type: "file" };
import faviconPath from "./assets/favicon.png" with { type: "file" };
import appCssPath from "./assets/app.css" with { type: "file" };
import { HomePage } from "./views/home";
import { BrowserContent } from "./views/browser";
import { ScanResults, ScanProgress, ScanProgressContent, GroupsPage, GroupCard, DupSummary, buildGroupView, getSortedGroups } from "./views/results";
import { Czkawka } from "./lib/czkawka";
import {
  deleteIds, hardlinkGroup, symlinkGroup, deleteExtrasGroup, deleteGroup,
  hardlinkAllGroups, symlinkAllGroups, deleteGroupExtras,
  type ActionResult, type BulkSummary,
} from "./lib/actions";
import { safeBrowsePath, BROWSE_ROOT } from "./lib/browse";
import {
  ScanForm, KeeperRequest, ResultsPageQuery,
  RowDeleteRequest, GroupActionRequest, BulkActionRequest,
} from "./lib/api";
import type { z } from "zod";
import { ErrorText, InfoText, MutedText, StaleResult, RowError, GroupErrorBanner } from "./components/Error";

const app = new Hono();

app.use(logger());

app.get("/healthz", (c) => c.text("ok"));

app.get("/static/htmx.min.js", () =>
  new Response(Bun.file(htmxPath), { headers: { "content-type": "application/javascript; charset=utf-8" } })
);

app.get("/static/app.css", () =>
  new Response(Bun.file(appCssPath), { headers: { "content-type": "text/css; charset=utf-8" } })
);

app.get("/favicon.ico", () =>
  new Response(Bun.file(faviconPath), { headers: { "content-type": "image/png" } })
);

app.get("/", (c) => c.html(<HomePage browseRoot={BROWSE_ROOT} />));

app.get("/browse", async (c) => {
  const raw = c.req.query("path") ?? BROWSE_ROOT;

  let resolvedPath = BROWSE_ROOT;
  let entries: string[] = [];
  let error: string | undefined;
  try {
    resolvedPath = safeBrowsePath(raw);
    const dirents = await fs.promises.readdir(resolvedPath, { withFileTypes: true });
    entries = dirents
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort((a, b) => a.localeCompare(b));
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }

  return c.html(<BrowserContent path={resolvedPath} entries={entries} error={error} root={BROWSE_ROOT} />);
});

app.post("/scan", async (c) => {
  const parsed = ScanForm.safeParse(await c.req.parseBody({ all: true }));
  if (!parsed.success) {
    return c.html(<ErrorText>{parsed.error.issues[0]?.message ?? "Invalid input"}</ErrorText>);
  }

  try {
    Czkawka.start(parsed.data);
    return c.html(<ScanProgress elapsed={0} message="Starting…" progress={undefined} />);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return c.html(<ErrorText>Failed to begin scan: {msg}</ErrorText>);
  }
});

app.get("/scan/status", (c) => {
  const s = Czkawka.status();

  // If the job is still running, just update the polling UI. This isn't just an optimization;
  // the Cancel button is part of the outer shell, and we don't want to reset it.
  if (s.kind === "running") {
    return c.html(<ScanProgressContent elapsed={s.elapsed} message={s.message} progress={s.progress} />);
  }

  // Terminal state: replace the polling UI with the result.
  c.header("HX-Retarget", "#scan-status");
  c.header("HX-Reswap",   "outerHTML");

  switch (s.kind) {
    case "idle":      return c.html(<MutedText>No active scan.</MutedText>);
    case "completed": return c.html(<ScanResults scan={s.scan} />);
    case "cancelled": return c.html(<InfoText>Scan cancelled.</InfoText>);
    case "failed":    return c.html(<ErrorText>Scan failed: {s.error}</ErrorText>);
    default:          return s satisfies never;
  }
});

app.get("/results/page", (c) => {
  const parsed = ResultsPageQuery.safeParse(c.req.query());
  if (!parsed.success) {
    return c.html(<ErrorText>{parsed.error.issues[0]?.message ?? "Invalid query"}</ErrorText>, 400);
  }
  const { scanId, offset, sort } = parsed.data;

  const scan = Czkawka.lookup(scanId);
  if (!scan) return c.html(<StaleResult />, 409);

  const groups = getSortedGroups(scan, sort);
  return c.html(<GroupsPage scanId={scan.id} groups={groups} offset={offset} sort={sort} />);
});

app.post("/scan/cancel", (c) => {
  const stopped = Czkawka.cancel();
  if (!stopped) return c.html(<InfoText>No scan was running.</InfoText>);
  return c.html(<InfoText>Scan cancelled.</InfoText>);
});

// Each action is its own POST endpoint; the URL is the discriminator. Three
// factories below cover the three body shapes (row delete / per-group /
// bulk) so the route registrations stay one-liners.

type ActionHandler = (c: Context) => Promise<Response>;

function withSafeParse<S extends z.ZodTypeAny>(
  schema: S,
  body: (data: z.infer<S>, c: Context) => Promise<Response> | Response,
): ActionHandler {
  return async (c) => {
    const parsed = schema.safeParse(await c.req.parseBody({ all: true }));
    if (!parsed.success) {
      return c.html(<ErrorText>{parsed.error.issues[0]?.message ?? "Invalid request"}</ErrorText>);
    }
    try {
      return await body(parsed.data, c);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return c.html(<ErrorText>{msg}</ErrorText>);
    }
  };
}

const groupAction = (
  fn: (scanId: string, gid: string) => Record<string, ActionResult>,
  verbLabel: string,
) => withSafeParse(GroupActionRequest, ({ scanId, gid }, c) => {
  const failures = collectFailures(fn(scanId, gid));
  if (failures.length === 0) return renderGroupUpdate(c, scanId, gid);
  return c.html(<GroupErrorBanner action={verbLabel} failures={failures} />);
});

function renderGroupUpdate(c: Context, scanId: string, gid: string): Response | Promise<Response> {
  c.header("HX-Retarget", `#dup-group-${gid}`);
  c.header("HX-Reswap",   "outerHTML");
  const scan = Czkawka.lookup(scanId);
  if (!scan) return c.html(<StaleResult />, 409);

  const group = scan.groups.get(gid);
  const groupCard = group
    ? <GroupCard scanId={scan.id} group={buildGroupView(scan, gid, group.ids, group.keeperIdx)} />
    : null;
  return c.html(
    <>
      {groupCard}
      <DupSummary scan={scan} oob />
    </>,
  );
}

const bulkAction = (
  fn: (scanId: string) => BulkSummary,
  pastTenseVerb: string,
) => withSafeParse(BulkActionRequest, ({ scanId }, c) => {
  const summary = fn(scanId);
  return c.html(<BulkSummaryView verb={pastTenseVerb} summary={summary} />);
});

app.post("/actions/row/delete", withSafeParse(RowDeleteRequest, ({ scanId, id }, c) => {
  const scan = Czkawka.lookup(scanId);
  const gidBefore = findGid(scan, id);
  const r = deleteIds(scanId, [id])[id]!;
  if (!r.ok) return c.html(<RowError message={`Delete failed: ${r.error}`} />);
  if (!gidBefore) return c.body(null);
  return renderGroupUpdate(c, scanId, gidBefore);
}));
app.post("/actions/group/hardlink",      groupAction(hardlinkGroup,     "Hardlink"));
app.post("/actions/group/symlink",       groupAction(symlinkGroup,      "Symlink"));
app.post("/actions/group/delete-extras", groupAction(deleteExtrasGroup, "Delete"));
app.post("/actions/group/delete-all",    groupAction(deleteGroup,       "Delete"));
app.post("/actions/bulk/hardlink",       bulkAction(hardlinkAllGroups,  "Hardlinked"));
app.post("/actions/bulk/symlink",        bulkAction(symlinkAllGroups,   "Symlinked"));
app.post("/actions/bulk/delete-extras",  bulkAction(deleteGroupExtras,  "Deleted"));

// Click-to-override keeper. Server is the source of truth for which file is
// the keeper; the click is just a request to mutate that state. Response is
// the re-rendered group section so htmx can outerHTML-swap it.
app.post("/keeper", async (c) => {
  const parsed = KeeperRequest.safeParse(await c.req.parseBody());
  if (!parsed.success) {
    return c.html(<ErrorText>{parsed.error.issues[0]?.message ?? "Invalid keeper request"}</ErrorText>, 400);
  }

  const { scanId, gid, keepId } = parsed.data;
  const group = Czkawka.setKeeper(scanId, gid, keepId);
  if (!group) {
    return c.html(<ErrorText>Stale results — re-run the scan.</ErrorText>, 409);
  }

  const scan = Czkawka.lookup(scanId)!;
  const view = buildGroupView(scan, gid, group.ids, group.keeperIdx);
  return c.html(<GroupCard scanId={scan.id} group={view} />);
});

function collectFailures(results: Record<string, ActionResult>): { id: string; error: string }[] {
  return Object.entries(results)
    .filter(([, r]) => !r.ok)
    .map(([id, r]) => ({ id, error: (r as { ok: false; error: string }).error }));
}

function findGid(scan: ReturnType<typeof Czkawka.lookup>, id: string): string | undefined {
  if (!scan) return undefined;
  for (const [gid, group] of scan.groups) {
    if (group.ids.includes(id)) return gid;
  }
  return undefined;
}

function BulkSummaryView({ verb, summary }: { verb: string; summary: BulkSummary }) {
  const cls = summary.failed === 0 ? "bulk-summary ok" : "bulk-summary partial";
  return (
    <div class={cls}>
      <strong>
        {verb} {summary.succeeded} of {summary.filesAttempted} file(s)
        {summary.totalGroups > 1 ? ` across ${summary.totalGroups} groups` : ""}
        . Re-scan to see remaining duplicates.
      </strong>
      {summary.failed > 0 ? (
        <details>
          <summary>{summary.failed} error(s)</summary>
          <ul>
            {summary.errors.slice(0, 50).map((e) => <li><code>{e.path}</code> — {e.error}</li>)}
            {summary.errors.length > 50 ? <li>… {summary.errors.length - 50} more</li> : null}
          </ul>
        </details>
      ) : null}
    </div>
  );
}

const port = Number(process.env.PORT ?? 3000);
export default { port, fetch: app.fetch };
