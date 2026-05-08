import { describe, expect, test } from "bun:test";
import {
  BadExtensionsResult,
  BigFilesResult,
  BrokenFilesResult,
  DuplicatesHashResult,
  DuplicatesNameResult,
  DuplicatesSizeNameResult,
  EmptyFilesResult,
  EmptyFoldersResult,
  SameMusicResult,
  SimilarImagesResult,
  SimilarVideosResult,
  SymlinksResult,
  TemporaryResult,
} from "../src/index";

// Fixtures match the JSON shape produced by `czkawka_cli ... --compact-file-to-save`.
// Cross-check against czkawka_core/src/tools/<tool>/mod.rs if czkawka changes.

describe("DuplicatesHashResult", () => {
  test("parses hash-method output (Record<sizeStr, DuplicateEntry[][]>)", () => {
    const raw = {
      "1024": [
        [
          { path: "/a/foo.bin", modified_date: 1700000000, size: 1024, hash: "deadbeef" },
          { path: "/b/foo.bin", modified_date: 1700000005, size: 1024, hash: "deadbeef" },
        ],
      ],
      "4096": [
        [
          { path: "/a/big.bin", modified_date: 1700000010, size: 4096, hash: "cafebabe" },
          { path: "/b/big.bin", modified_date: 1700000010, size: 4096, hash: "cafebabe" },
          { path: "/c/big.bin", modified_date: 1700000010, size: 4096, hash: "cafebabe" },
        ],
      ],
    };
    const parsed = DuplicatesHashResult.parse(raw);
    expect(Object.keys(parsed)).toEqual(["1024", "4096"]);
    expect(parsed["4096"]![0]).toHaveLength(3);
    expect(parsed["1024"]![0]![0]!.hash).toBe("deadbeef");
  });

  test("rejects entries missing required fields", () => {
    const bad = { "1024": [[{ path: "/a", size: 1024 }]] };
    expect(() => DuplicatesHashResult.parse(bad)).toThrow();
  });
});

describe("DuplicatesNameResult", () => {
  test("parses name-method output (Record<name, DuplicateEntry[]>)", () => {
    const raw = {
      "report.pdf": [
        { path: "/docs/report.pdf", modified_date: 1700000000, size: 2048, hash: "" },
        { path: "/backup/report.pdf", modified_date: 1700000100, size: 2050, hash: "" },
      ],
    };
    const parsed = DuplicatesNameResult.parse(raw);
    expect(parsed["report.pdf"]).toHaveLength(2);
  });
});

describe("DuplicatesSizeNameResult", () => {
  test("parses size-name output (DuplicateEntry[][])", () => {
    const raw = [
      [
        { path: "/a/foo.txt", modified_date: 1, size: 5, hash: "" },
        { path: "/b/foo.txt", modified_date: 2, size: 5, hash: "" },
      ],
    ];
    const parsed = DuplicatesSizeNameResult.parse(raw);
    expect(parsed[0]).toHaveLength(2);
  });
});

describe("BigFilesResult / EmptyFilesResult", () => {
  test("flat FileEntry array", () => {
    const raw = [
      { path: "/var/log/big.log", size: 1_000_000_000, modified_date: 1700000000 },
      { path: "/tmp/big.bin", size: 999_000_000, modified_date: 1700000050 },
    ];
    expect(BigFilesResult.parse(raw)).toHaveLength(2);
    expect(EmptyFilesResult.parse([])).toEqual([]);
  });
});

describe("EmptyFoldersResult", () => {
  test("string array of folder paths", () => {
    const raw = ["/empty/one", "/empty/two/nested"];
    expect(EmptyFoldersResult.parse(raw)).toEqual(raw);
  });

  test("rejects non-string entries", () => {
    expect(() => EmptyFoldersResult.parse([{ path: "/x" }])).toThrow();
  });
});

describe("TemporaryResult", () => {
  test("array of TemporaryEntry", () => {
    const raw = [{ path: "/tmp/foo.tmp", modified_date: 1700000000, size: 12 }];
    expect(TemporaryResult.parse(raw)[0]!.path).toBe("/tmp/foo.tmp");
  });
});

describe("SimilarImagesResult", () => {
  test("groups of ImagesEntry with hash treated as opaque", () => {
    const raw = [
      [
        {
          path: "/img/a.jpg",
          size: 50_000,
          width: 1920,
          height: 1080,
          modified_date: 1700000000,
          hash: [1, 2, 3, 4, 5, 6, 7, 8],
          difference: 0,
        },
        {
          path: "/img/a-edit.jpg",
          size: 51_000,
          width: 1920,
          height: 1080,
          modified_date: 1700000300,
          hash: [1, 2, 3, 4, 5, 6, 7, 9],
          difference: 3,
        },
      ],
    ];
    const parsed = SimilarImagesResult.parse(raw);
    expect(parsed[0]![1]!.difference).toBe(3);
    expect(parsed[0]![0]!.width).toBe(1920);
  });
});

describe("SimilarVideosResult", () => {
  test("nullable codec/fps/bitrate/duration fields", () => {
    const raw = [
      [
        {
          path: "/v/a.mp4",
          size: 10_000_000,
          modified_date: 1700000000,
          error: "",
          fps: 30,
          codec: "h264",
          bitrate: 4_000_000,
          width: 1920,
          height: 1080,
          duration: 120.5,
        },
        {
          path: "/v/a-broken.mp4",
          size: 10_000_000,
          modified_date: 1700000000,
          error: "",
          fps: null,
          codec: null,
          bitrate: null,
          width: null,
          height: null,
          duration: null,
        },
      ],
    ];
    const parsed = SimilarVideosResult.parse(raw);
    expect(parsed[0]![0]!.codec).toBe("h264");
    expect(parsed[0]![1]!.codec).toBeNull();
  });
});

describe("SameMusicResult", () => {
  test("MusicEntry with metadata strings", () => {
    const raw = [
      [
        {
          path: "/music/a.mp3",
          size: 4_000_000,
          modified_date: 1700000000,
          track_title: "Song",
          track_artist: "Artist",
          year: "2024",
          length: 217,
          genre: "Rock",
          bitrate: 320,
        },
        {
          path: "/music/a-copy.mp3",
          size: 4_000_000,
          modified_date: 1700000010,
          track_title: "Song",
          track_artist: "Artist",
          year: "2024",
          length: 217,
          genre: "Rock",
          bitrate: 320,
        },
      ],
    ];
    expect(SameMusicResult.parse(raw)[0]).toHaveLength(2);
  });
});

describe("SymlinksResult", () => {
  test("includes symlink_info with destination and error type", () => {
    const raw = [
      {
        path: "/dangling",
        size: 0,
        modified_date: 1700000000,
        symlink_info: { destination_path: "/missing", type_of_error: "NonExistentFile" },
      },
    ];
    const parsed = SymlinksResult.parse(raw);
    expect(parsed[0]!.symlink_info.type_of_error).toBe("NonExistentFile");
  });
});

describe("BrokenFilesResult", () => {
  test("errors recorded as Record<string,string>", () => {
    const raw = [
      {
        path: "/x/broken.png",
        modified_date: 1700000000,
        size: 12345,
        errors: { "decode": "invalid PNG header" },
      },
    ];
    expect(BrokenFilesResult.parse(raw)[0]!.errors.decode).toContain("invalid");
  });
});

describe("BadExtensionsResult", () => {
  test("captures current vs proper extension", () => {
    const raw = [
      {
        path: "/a/file.txt",
        modified_date: 1700000000,
        size: 100,
        current_extension: "txt",
        proper_extensions_group: "image/jpeg",
        proper_extension: "jpg",
      },
    ];
    expect(BadExtensionsResult.parse(raw)[0]!.proper_extension).toBe("jpg");
  });
});

describe("Empty result handling", () => {
  test.each([
    ["DuplicatesHashResult", DuplicatesHashResult, {}],
    ["DuplicatesSizeNameResult", DuplicatesSizeNameResult, []],
    ["BigFilesResult", BigFilesResult, []],
    ["EmptyFoldersResult", EmptyFoldersResult, []],
    ["SimilarImagesResult", SimilarImagesResult, []],
  ])("%s parses an empty result", (_name, schema, empty) => {
    expect(() => schema.parse(empty)).not.toThrow();
  });
});
