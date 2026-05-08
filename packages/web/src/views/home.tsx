import { Layout } from "./layout";

export const HomePage = ({ browseRoot }: { browseRoot: string }) => (
  <Layout>
    <form
      hx-post="/scan"
      hx-target="#results"
      hx-swap="innerHTML"
      hx-indicator="#spinner"
    >
      <PathListField
        list="scan"
        name="dirs"
        label="Directories to scan"
        hint="Reorder to change default priorities of duplicate files (e.g. if you prefer to keep copies from /media instead of /seed)"
        browseRoot={browseRoot}
      />

      <PathListField
        list="exclude"
        name="excludeDirs"
        label="Exclude directories (optional)"
        hint="Anything matching one of these paths is skipped."
        browseRoot={browseRoot}
      />

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
        <div class="field">
          <label for="comparator">Match method</label>
          <select id="comparator" name="comparator">
            <option value="hash">Hash</option>
            <option value="size">Size</option>
            <option value="name">Name</option>
            <option value="size_name">Name + Size</option>
          </select>
        </div>
        <div class="field">
          <label for="minSize">Min file size (bytes)</label>
          <input id="minSize" name="minSize" type="number" placeholder="8096" />
        </div>
      </div>

      <div style="display:flex;align-items:center;gap:12px">
        <button id="scan-submit" type="submit">Find duplicates</button>
        <span id="spinner" class="htmx-indicator" style="color:#888;font-size:12px">
          Scanning…
        </span>
      </div>
    </form>

    <div id="results" class="results" />
  </Layout>
);

function PathListField({
  list, name, label, hint, browseRoot,
}: {
  list: "scan" | "exclude";
  name: string;
  label: string;
  hint: string;
  browseRoot: string;
}) {
  return (
    <div class="field">
      <div class="field-label-row">
        <label>{label}</label>
        <div class="field-actions">
          <button type="button" class="btn-browse btn-edit-toggle" data-list={list}>Edit</button>
          <button type="button" class="btn-browse btn-list-recent" data-list={list}>Recent</button>
        </div>
      </div>
      <ul class="path-list" data-list={list} data-name={name} data-root={browseRoot}>
        <li class="path-list-add" data-list={list}>+ Browse</li>
      </ul>
      <textarea class="path-list-textarea" data-list={list} rows={6} placeholder="One path per line" hidden />
      <div class="field-hint">{hint}</div>
    </div>
  );
}
