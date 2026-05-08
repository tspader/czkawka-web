import { z } from "zod";

// ── Base ──────────────────────────────────────────────────────────────────────

export const FileEntry = z.object({
  path: z.string(),
  size: z.number(),
  modified_date: z.number(),
});
export type FileEntry = z.infer<typeof FileEntry>;

// ── Duplicates ────────────────────────────────────────────────────────────────
// JSON shape depends on --check-method:
//   name      → Record<string, DuplicateEntry[]>
//   size      → Record<string, DuplicateEntry[]>     (key = size as string)
//   size-name → DuplicateEntry[][]
//   hash      → Record<string, DuplicateEntry[][]>   (key = size as string)

export const DuplicateEntry = z.object({
  path: z.string(),
  modified_date: z.number(),
  size: z.number(),
  hash: z.string(),
});
export type DuplicateEntry = z.infer<typeof DuplicateEntry>;

export const DuplicatesHashResult = z.record(z.string(), z.array(z.array(DuplicateEntry)));
export const DuplicatesNameResult = z.record(z.string(), z.array(DuplicateEntry));
export const DuplicatesSizeNameResult = z.array(z.array(DuplicateEntry));
export type DuplicatesHashResult = z.infer<typeof DuplicatesHashResult>;
export type DuplicatesNameResult = z.infer<typeof DuplicatesNameResult>;
export type DuplicatesSizeNameResult = z.infer<typeof DuplicatesSizeNameResult>;

// ── Big files ─────────────────────────────────────────────────────────────────
// Vec<FileEntry>

export const BigFilesResult = z.array(FileEntry);
export type BigFilesResult = z.infer<typeof BigFilesResult>;

// ── Empty files ───────────────────────────────────────────────────────────────
// Vec<FileEntry>

export const EmptyFilesResult = z.array(FileEntry);
export type EmptyFilesResult = z.infer<typeof EmptyFilesResult>;

// ── Empty folders ─────────────────────────────────────────────────────────────
// Vec<&PathBuf> — just the map keys, serialized as string[]

export const EmptyFoldersResult = z.array(z.string());
export type EmptyFoldersResult = z.infer<typeof EmptyFoldersResult>;

// ── Temporary files ───────────────────────────────────────────────────────────

export const TemporaryEntry = z.object({
  path: z.string(),
  modified_date: z.number(),
  size: z.number(),
});
export type TemporaryEntry = z.infer<typeof TemporaryEntry>;

export const TemporaryResult = z.array(TemporaryEntry);
export type TemporaryResult = z.infer<typeof TemporaryResult>;

// ── Similar images ────────────────────────────────────────────────────────────
// Vec<Vec<ImagesEntry>> — groups of similar images

export const ImagesEntry = z.object({
  path: z.string(),
  size: z.number(),
  width: z.number(),
  height: z.number(),
  modified_date: z.number(),
  hash: z.unknown(), // ImHash — opaque bytes, not useful in UI
  difference: z.number(),
});
export type ImagesEntry = z.infer<typeof ImagesEntry>;

export const SimilarImagesResult = z.array(z.array(ImagesEntry));
export type SimilarImagesResult = z.infer<typeof SimilarImagesResult>;

// ── Similar videos ────────────────────────────────────────────────────────────
// Vec<Vec<VideosEntry>> — groups of similar videos

export const VideosEntry = z.object({
  path: z.string(),
  size: z.number(),
  modified_date: z.number(),
  error: z.string(),
  fps: z.number().nullable(),
  codec: z.string().nullable(),
  bitrate: z.number().nullable(),
  width: z.number().nullable(),
  height: z.number().nullable(),
  duration: z.number().nullable(),
});
export type VideosEntry = z.infer<typeof VideosEntry>;

export const SimilarVideosResult = z.array(z.array(VideosEntry));
export type SimilarVideosResult = z.infer<typeof SimilarVideosResult>;

// ── Same music ────────────────────────────────────────────────────────────────
// Vec<Vec<MusicEntry>> — groups of duplicate tracks

export const MusicEntry = z.object({
  path: z.string(),
  size: z.number(),
  modified_date: z.number(),
  track_title: z.string(),
  track_artist: z.string(),
  year: z.string(),
  length: z.number(),
  genre: z.string(),
  bitrate: z.number(),
});
export type MusicEntry = z.infer<typeof MusicEntry>;

export const SameMusicResult = z.array(z.array(MusicEntry));
export type SameMusicResult = z.infer<typeof SameMusicResult>;

// ── Invalid symlinks ──────────────────────────────────────────────────────────

export const SymlinkInfo = z.object({
  destination_path: z.string(),
  type_of_error: z.string(),
});

export const SymlinksEntry = z.object({
  path: z.string(),
  size: z.number(),
  modified_date: z.number(),
  symlink_info: SymlinkInfo,
});
export type SymlinksEntry = z.infer<typeof SymlinksEntry>;

export const SymlinksResult = z.array(SymlinksEntry);
export type SymlinksResult = z.infer<typeof SymlinksResult>;

// ── Broken files ──────────────────────────────────────────────────────────────

export const BrokenEntry = z.object({
  path: z.string(),
  modified_date: z.number(),
  size: z.number(),
  errors: z.record(z.string(), z.string()),
});
export type BrokenEntry = z.infer<typeof BrokenEntry>;

export const BrokenFilesResult = z.array(BrokenEntry);
export type BrokenFilesResult = z.infer<typeof BrokenFilesResult>;

// ── Bad extensions ────────────────────────────────────────────────────────────

export const BadExtensionEntry = z.object({
  path: z.string(),
  modified_date: z.number(),
  size: z.number(),
  current_extension: z.string(),
  proper_extensions_group: z.string(),
  proper_extension: z.string(),
});
export type BadExtensionEntry = z.infer<typeof BadExtensionEntry>;

export const BadExtensionsResult = z.array(BadExtensionEntry);
export type BadExtensionsResult = z.infer<typeof BadExtensionsResult>;

// This is synthetic; Czkawka emits bare results, and we stick a tag on it so that
// we can parse it as a discriminated union
export const ScanResult = z.discriminatedUnion("type", [
  z.object({ type: z.literal("dup-hash"),      data: DuplicatesHashResult }),
  z.object({ type: z.literal("dup-name"),      data: DuplicatesNameResult }),
  z.object({ type: z.literal("dup-size-name"), data: DuplicatesSizeNameResult }),
  z.object({ type: z.literal("big"),           data: BigFilesResult }),
  z.object({ type: z.literal("empty-files"),   data: EmptyFilesResult }),
  z.object({ type: z.literal("empty-folders"), data: EmptyFoldersResult }),
  z.object({ type: z.literal("temp"),          data: TemporaryResult }),
  z.object({ type: z.literal("image"),         data: SimilarImagesResult }),
  z.object({ type: z.literal("video"),         data: SimilarVideosResult }),
  z.object({ type: z.literal("music"),         data: SameMusicResult }),
  z.object({ type: z.literal("symlinks"),      data: SymlinksResult }),
  z.object({ type: z.literal("broken"),        data: BrokenFilesResult }),
  z.object({ type: z.literal("ext"),           data: BadExtensionsResult }),
]);
export type ScanResult = z.infer<typeof ScanResult>;
