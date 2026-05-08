import type { FC, PropsWithChildren } from "hono/jsx";

export const ErrorText: FC<PropsWithChildren> = ({ children }) => (
  <p class="error">{children}</p>
);

export const InfoText: FC<PropsWithChildren> = ({ children }) => (
  <p class="info">{children}</p>
);

export const MutedText: FC<PropsWithChildren> = ({ children }) => (
  <p style="color:#666">{children}</p>
);

export const StaleResult: FC = () => (
  <ErrorText>Results are stale — re-run the scan.</ErrorText>
);

export const RowError: FC<{ message: string }> = ({ message }) => (
  // Replaces a single .dup-file row. Keeps the grid layout so the message
  // shows up where the path normally is, leaving the rest empty.
  <li class="dup-file" style="cursor:default;border-left-color:#3b0a0a">
    <span class="dup-marker" style="color:#f87171">err</span>
    <span class="dup-path" style="color:#f87171">{message}</span>
    <span class="dup-mtime" />
    <span />
  </li>
);

export const GroupErrorBanner: FC<{
  action: string;
  failures: { id: string; error: string }[];
}> = ({ action, failures }) => (
  <div class="dup-group-error">
    <strong>{action} failed for {failures.length} file(s).</strong>
    <ul>
      {failures.slice(0, 20).map((f) => <li>{f.id}: {f.error}</li>)}
      {failures.length > 20 ? <li>… {failures.length - 20} more</li> : null}
    </ul>
  </div>
);
