import { describe, expect, it } from "vitest";
import { findPreparedSongs } from "./librarySearch";
import type { PreparedSummary } from "./preparedSongs";

const songs: PreparedSummary[] = [
  {
    id: 3,
    title: "Обійми",
    artist: "Океан Ельзи",
    cover: "",
    duration: 240,
    local: true,
  },
  {
    id: 1,
    title: "М'ята",
    artist: "Назва гурту",
    cover: "",
    duration: 180,
    local: false,
  },
  {
    id: 2,
    title: "BIRDS OF A FEATHER",
    artist: "Billie Eilish",
    cover: "",
    duration: 210,
    local: true,
  },
];

describe("prepared library search", () => {
  it("finds a song by title and artist in any order, ignoring case and extra spaces", () => {
    expect(findPreparedSongs(songs, " ЕЛЬЗИ   обій ").map((s) => s.id)).toEqual(
      [3],
    );
    expect(findPreparedSongs(songs, "billie feather").map((s) => s.id)).toEqual(
      [2],
    );
    expect(findPreparedSongs(songs, "обійми billie")).toEqual([]);
  });
  it("matches typographic Ukrainian apostrophes and Unicode-compatible letters", () => {
    expect(findPreparedSongs(songs, "мʼята").map((s) => s.id)).toEqual([1]);
    expect(findPreparedSongs(songs, "м’ята").map((s) => s.id)).toEqual([1]);
    expect(findPreparedSongs(songs, "ＢＩＲＤＳ").map((s) => s.id)).toEqual([
      2,
    ]);
  });
  it("keeps the saved order and summaries intact when clearing the search", () => {
    const result = findPreparedSongs(songs, "  ");
    expect(result).toEqual(songs);
    expect(result[0]).toBe(songs[0]);
    expect(songs.map((s) => s.id)).toEqual([3, 1, 2]);
  });
});
