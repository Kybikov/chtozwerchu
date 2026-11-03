import type { PreparedSummary } from "./preparedSongs";

const searchable = (value: string) =>
  value
    .normalize("NFKC")
    .toLocaleLowerCase("uk")
    .replace(/[’ʼ‘`]/g, "'");

export function findPreparedSongs(songs: PreparedSummary[], query: string) {
  const terms = searchable(query).trim().split(/\s+/).filter(Boolean);
  return songs.filter((song) => {
    const text = searchable(`${song.title} ${song.artist}`);
    return terms.every((term) => text.includes(term));
  });
}
