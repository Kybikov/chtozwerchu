CREATE TABLE IF NOT EXISTS users (
    id           TEXT PRIMARY KEY,
    email        TEXT UNIQUE NOT NULL,
    pass_hash    TEXT NOT NULL,
    display_name TEXT NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS songs (
    id          TEXT PRIMARY KEY,
    title       TEXT NOT NULL,
    artist      TEXT NOT NULL,
    pack        TEXT NOT NULL DEFAULT 'ua',
    era         TEXT NOT NULL DEFAULT '',
    aliases     JSONB NOT NULL DEFAULT '[]',
    phrases     JSONB NOT NULL DEFAULT '[]',
    preview_url TEXT NOT NULL DEFAULT '',
    youtube     TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS statements (
    id    TEXT PRIMARY KEY,
    text  TEXT NOT NULL,
    truth BOOLEAN NOT NULL,
    fact  TEXT NOT NULL DEFAULT '',
    pack  TEXT NOT NULL DEFAULT 'general'
);

CREATE TABLE IF NOT EXISTS alias_cards (
    id    TEXT PRIMARY KEY,
    word  TEXT NOT NULL,
    taboo JSONB NOT NULL DEFAULT '[]',
    pack  TEXT NOT NULL DEFAULT 'general'
);

CREATE TABLE IF NOT EXISTS crocodile_puzzles (
    id     TEXT PRIMARY KEY,
    emoji  TEXT NOT NULL,
    answer TEXT NOT NULL,
    hint   TEXT NOT NULL DEFAULT '',
    pack   TEXT NOT NULL DEFAULT 'general'
);

CREATE TABLE IF NOT EXISTS matches (
    id         TEXT PRIMARY KEY,
    code       TEXT NOT NULL,
    config     JSONB NOT NULL DEFAULT '{}',
    started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    ended_at   TIMESTAMPTZ,
    winner     TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS match_players (
    match_id TEXT NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
    user_id  TEXT REFERENCES users(id) ON DELETE SET NULL,
    name     TEXT NOT NULL,
    team     TEXT NOT NULL,
    score    INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_match_players_user ON match_players(user_id);
CREATE INDEX IF NOT EXISTS idx_matches_code ON matches(code);
