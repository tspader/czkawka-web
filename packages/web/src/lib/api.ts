import { z } from "zod";

// Normalize element-or-array into array
const lines = z.preprocess((v) => {
  const arr = Array.isArray(v) ? v : v == null ? [] : [v];
  return arr.map((x) => String(x).trim()).filter(Boolean);
}, z.array(z.string()));


export const ScanForm = z.object({
  dirs: lines.pipe(z.array(z.string()).min(1, "Please add at least one directory.")),
  excludeDirs: lines,
  minSize: z.preprocess(
    (v) => (v === "" || v == null ? undefined : Number(v)),
    z.number().int().nonnegative().optional(),
  ),
  comparator: z.enum(["hash", "name", "size", "size_name"]),
});
export type ScanForm = z.infer<typeof ScanForm>;

export const SortMode = z.enum(["group-size", "file-size", "path", "mtime"]);
export type SortMode = z.infer<typeof SortMode>;


export const ResultsPageQuery = z.object({
  scanId: z.string().min(1, "Missing scanId"),
  offset: z.coerce.number().int().nonnegative().catch(0),
  sort: SortMode.optional().default("group-size"),
});
export type ResultsPageQuery = z.infer<typeof ResultsPageQuery>;


const gidField = z.string().min(1);

export const RowDeleteRequest = z.object({ scanId: z.string(), id: z.string().min(1) });
export const GroupActionRequest = z.object({ scanId: z.string(), gid: gidField });
export const BulkActionRequest = z.object({ scanId: z.string() });

export const KeeperRequest = z.object({
  scanId: z.string(),
  gid:    gidField,
  keepId: z.string().min(1),
});
export type KeeperRequest = z.infer<typeof KeeperRequest>;
