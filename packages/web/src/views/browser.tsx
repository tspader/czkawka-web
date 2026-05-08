import type { FC } from "hono/jsx";
import * as path from "path";

interface Props {
  path: string;
  entries: string[];
  error?: string;
  root: string;
}

function FolderIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor" style="flex-shrink:0;opacity:0.5">
      <path d="M.54 3.87.5 3a2 2 0 0 1 2-2h3.19a2 2 0 0 1 1.45.63l.07.07L8.05 2h5.95a2 2 0 0 1 2 1.99V13a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2V4.72a2 2 0 0 1 .54-1.28z" />
    </svg>
  );
}

export const BrowserContent: FC<Props> = ({ path: dirPath, entries, error, root }) => {
  const crumbs = buildCrumbs(dirPath, root);

  return (
    <>
      <div class="modal-header">
        <nav class="breadcrumb">
          {crumbs.map((crumb, i) => (
            <>
              {i > 0 && <span class="crumb-sep">›</span>}
              <button
                class={`crumb${i === crumbs.length - 1 ? " crumb-active" : ""}`}
                hx-get={`/browse?path=${encodeURIComponent(crumb.path)}`}
                hx-target="#browser-content"
                hx-swap="innerHTML"
              >
                {crumb.label}
              </button>
            </>
          ))}
        </nav>
        <button
          class="modal-close"
          hx-on:click="document.getElementById('modal').hidden = true"
          aria-label="Close"
        >
          ✕
        </button>
      </div>

      <ul class="dir-list">
        {error ? (
          <li class="dir-message dir-error">{error}</li>
        ) : entries.length === 0 ? (
          <li class="dir-message">No subdirectories</li>
        ) : (
          entries.map((name) => {
            const child = path.posix.join(dirPath, name);
            return (
              <li
                class="dir-entry"
                hx-get={`/browse?path=${encodeURIComponent(child)}`}
                hx-target="#browser-content"
                hx-swap="innerHTML"
                hx-trigger="click"
              >
                <FolderIcon />
                {name}
              </li>
            );
          })
        )}
      </ul>

      <div class="modal-footer">
        <span class="modal-current-path">{dirPath}</span>
        <button
          class="btn-select"
          data-path={dirPath}
          hx-on:click="window.czkawkaSelectDir(this.dataset.path)"
        >
          Select
        </button>
      </div>
    </>
  );
};

function buildCrumbs(dirPath: string, root: string) {
  const rootLabel = root === "/" ? "/" : path.posix.basename(root) || root;
  if (dirPath === root) return [{ label: rootLabel, path: root }];

  const rel = path.posix.relative(root, dirPath);
  const segments = rel.split("/").filter(Boolean);
  const crumbs = [{ label: rootLabel, path: root }];
  let cur = root;
  for (const seg of segments) {
    cur = path.posix.join(cur, seg);
    crumbs.push({ label: seg, path: cur });
  }
  return crumbs;
}
