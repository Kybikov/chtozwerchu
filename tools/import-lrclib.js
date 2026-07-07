const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const tracksPath = process.argv[2] ? path.resolve(process.argv[2]) : path.join(__dirname, "ua-modern-tracks.json");
const outputPath = process.argv[3] ? path.resolve(process.argv[3]) : path.join(root, "custom-songs.json");
const maxPhrasesPerSong = Number(process.env.MAX_PHRASES_PER_SONG || 4);
const requestTimeoutMs = Number(process.env.LRCLIB_TIMEOUT_MS || 8000);

const blockedLinePatterns = [
  /^\[.*\]$/,
  /^переклад/i,
  /^lyrics/i,
  /^copyright/i,
  /^embed$/i
];

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function cleanId(value) {
  const translit = {
    а: "a", б: "b", в: "v", г: "h", ґ: "g", д: "d", е: "e", є: "ie", ж: "zh", з: "z", и: "y", і: "i", ї: "i", й: "i",
    к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "kh", ц: "ts",
    ч: "ch", ш: "sh", щ: "shch", ь: "", ю: "iu", я: "ia", ё: "e", ы: "y", э: "e", ъ: ""
  };
  return clean(value)
    .toLocaleLowerCase("uk-UA")
    .replace(/[а-яёіїєґ]/giu, (char) => translit[char.toLocaleLowerCase("uk-UA")] || "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || `song-${Date.now()}`;
}

function stripLrcTime(line) {
  return line.replace(/^\s*(\[[0-9:.]+\]\s*)+/, "");
}

function tokenizeLine(line) {
  return stripLrcTime(line)
    .replace(/[()[\]{}"«»„“”]/g, " ")
    .replace(/[!?.,;:]+/g, " ")
    .split(/\s+/)
    .map((word) => clean(word))
    .filter(Boolean);
}

function lineScore(words) {
  const text = words.join(" ").toLocaleLowerCase("uk-UA");
  let score = 0;
  if (words.length >= 5 && words.length <= 9) score += 5;
  if (/[іїєґ]/i.test(text)) score += 3;
  if (/(коха|люб|серц|небо|ніч|дім|мама|Україн|воля|танц|очі|ти|я)/i.test(text)) score += 2;
  if (words.some((word) => word.length > 13)) score -= 2;
  return score;
}

function extractPhrases(lyrics) {
  const candidates = [];
  const seen = new Set();
  for (const rawLine of String(lyrics || "").split(/\r?\n/)) {
    const line = clean(stripLrcTime(rawLine));
    if (!line || blockedLinePatterns.some((pattern) => pattern.test(line))) continue;
    const words = tokenizeLine(line);
    if (words.length < 5) continue;
    const windows = [];
    if (words.length === 5) windows.push(words);
    else {
      windows.push(words.slice(0, 5));
      if (words.length >= 8) windows.push(words.slice(Math.max(0, Math.floor((words.length - 5) / 2), 0), Math.max(0, Math.floor((words.length - 5) / 2), 0) + 5));
      windows.push(words.slice(-5));
    }
    for (const phrase of windows) {
      if (phrase.length !== 5) continue;
      const key = phrase.join(" ").toLocaleLowerCase("uk-UA");
      if (seen.has(key)) continue;
      seen.add(key);
      candidates.push({ phrase, score: lineScore(words) });
    }
  }
  return candidates
    .sort((a, b) => b.score - a.score)
    .slice(0, maxPhrasesPerSong)
    .map((item) => item.phrase);
}

async function searchLyrics(track) {
  const params = new URLSearchParams();
  params.set("track_name", track.title);
  params.set("artist_name", track.artist);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);
  const response = await fetch(`https://lrclib.net/api/search?${params.toString()}`, {
    headers: { "user-agent": "five-words-party-game/1.0 (local importer)" },
    signal: controller.signal
  }).finally(() => clearTimeout(timeout));
  if (!response.ok) throw new Error(`LRCLIB ${response.status}`);
  const records = await response.json();
  if (!Array.isArray(records) || !records.length) return null;

  const normalizedTitle = clean(track.title).toLocaleLowerCase("uk-UA");
  const normalizedArtist = clean(track.artist).toLocaleLowerCase("uk-UA");
  return records
    .map((record) => {
      const trackName = clean(record.trackName).toLocaleLowerCase("uk-UA");
      const artistName = clean(record.artistName).toLocaleLowerCase("uk-UA");
      let score = 0;
      if (trackName === normalizedTitle) score += 20;
      else if (trackName.includes(normalizedTitle) || normalizedTitle.includes(trackName)) score += 10;
      if (artistName === normalizedArtist) score += 20;
      else if (artistName.includes(normalizedArtist) || normalizedArtist.includes(artistName)) score += 8;
      if (record.syncedLyrics) score += 3;
      if (record.plainLyrics) score += 2;
      return { record, score };
    })
    .sort((a, b) => b.score - a.score)[0]?.record || null;
}

async function main() {
  const tracks = JSON.parse(fs.readFileSync(tracksPath, "utf8"));
  const imported = [];
  const misses = [];

  for (const track of tracks) {
    process.stdout.write(`Searching: ${track.artist} - ${track.title} ... `);
    try {
      const record = await searchLyrics(track);
      const lyrics = record?.plainLyrics || record?.syncedLyrics || "";
      const phrases = extractPhrases(lyrics);
      if (!record || !phrases.length) {
        misses.push({ title: track.title, artist: track.artist, reason: record ? "no usable 5-word lines" : "not found" });
        process.stdout.write("miss\n");
        continue;
      }
      imported.push({
        id: track.id || cleanId(`${track.artist}-${track.title}`),
        title: track.title,
        artist: track.artist,
        pack: track.pack || "ua",
        era: track.era || "20",
        aliases: track.aliases || [track.title],
        source: {
          provider: "lrclib",
          trackName: record.trackName,
          artistName: record.artistName,
          synced: Boolean(record.syncedLyrics)
        },
        phrases
      });
      process.stdout.write(`${phrases.length} phrases\n`);
    } catch (error) {
      misses.push({ title: track.title, artist: track.artist, reason: error.message });
      process.stdout.write(`error: ${error.message}\n`);
    }
  }

  fs.writeFileSync(outputPath, `${JSON.stringify(imported, null, 2)}\n`, "utf8");
  const reportPath = outputPath.replace(/\.json$/i, ".report.json");
  fs.writeFileSync(reportPath, `${JSON.stringify({ imported: imported.length, missed: misses.length, misses }, null, 2)}\n`, "utf8");
  console.log(`\nImported ${imported.length} songs into ${outputPath}`);
  console.log(`Report: ${reportPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
