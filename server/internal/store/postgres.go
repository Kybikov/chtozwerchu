package store

import (
	"context"
	_ "embed"
	"encoding/json"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"chtozverchu/internal/game"
)

//go:embed schema.sql
var schemaSQL string

// DB wraps the Postgres connection pool.
type DB struct {
	pool *pgxpool.Pool
}

// Connect opens a pooled connection, retrying briefly so the app can start
// alongside a freshly-booted database (docker-compose).
func Connect(ctx context.Context, url string) (*DB, error) {
	var pool *pgxpool.Pool
	var err error
	for attempt := 0; attempt < 15; attempt++ {
		pool, err = pgxpool.New(ctx, url)
		if err == nil {
			if err = pool.Ping(ctx); err == nil {
				return &DB{pool: pool}, nil
			}
			pool.Close()
		}
		time.Sleep(2 * time.Second)
	}
	return nil, fmt.Errorf("postgres connect: %w", err)
}

func (db *DB) Close() { db.pool.Close() }

func (db *DB) Pool() *pgxpool.Pool { return db.pool }

// Migrate applies the embedded schema (idempotent CREATE TABLE IF NOT EXISTS).
func (db *DB) Migrate(ctx context.Context) error {
	if _, err := db.pool.Exec(ctx, schemaSQL); err != nil {
		return fmt.Errorf("migrate: %w", err)
	}
	return nil
}

// Seed loads bundled content into empty tables.
func (db *DB) Seed(ctx context.Context) error {
	if err := db.seedSongs(ctx); err != nil {
		return err
	}
	if err := db.seedStatements(ctx); err != nil {
		return err
	}
	if err := db.seedAlias(ctx); err != nil {
		return err
	}
	if err := db.seedCrocodile(ctx); err != nil {
		return err
	}
	return nil
}

func (db *DB) tableEmpty(ctx context.Context, table string) (bool, error) {
	var n int
	if err := db.pool.QueryRow(ctx, "SELECT count(*) FROM "+table).Scan(&n); err != nil {
		return false, err
	}
	return n == 0, nil
}

type seedSong struct {
	ID      string     `json:"id"`
	Title   string     `json:"title"`
	Artist  string     `json:"artist"`
	Pack    string     `json:"pack"`
	Era     string     `json:"era"`
	Aliases []string   `json:"aliases"`
	Phrases [][]string `json:"phrases"`
}

func (db *DB) seedSongs(ctx context.Context) error {
	empty, err := db.tableEmpty(ctx, "songs")
	if err != nil || !empty {
		return err
	}
	var songs []seedSong
	if err := json.Unmarshal(seedSongs, &songs); err != nil {
		return fmt.Errorf("parse songs seed: %w", err)
	}
	batch := db.pool
	for _, s := range songs {
		aliases, _ := json.Marshal(orEmptyStr(s.Aliases))
		phrases, _ := json.Marshal(orEmptyPhrases(s.Phrases))
		if _, err := batch.Exec(ctx,
			`INSERT INTO songs (id, title, artist, pack, era, aliases, phrases)
			 VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (id) DO NOTHING`,
			s.ID, s.Title, s.Artist, orDefault(s.Pack, "ua"), s.Era, aliases, phrases); err != nil {
			return fmt.Errorf("seed song %s: %w", s.ID, err)
		}
	}
	return nil
}

func (db *DB) seedStatements(ctx context.Context) error {
	empty, err := db.tableEmpty(ctx, "statements")
	if err != nil || !empty {
		return err
	}
	var items []game.Statement
	if err := json.Unmarshal(seedStatements, &items); err != nil {
		return fmt.Errorf("parse statements seed: %w", err)
	}
	for _, s := range items {
		if _, err := db.pool.Exec(ctx,
			`INSERT INTO statements (id, text, truth, fact, pack)
			 VALUES ($1,$2,$3,$4,$5) ON CONFLICT (id) DO NOTHING`,
			s.ID, s.Text, s.Truth, s.Fact, orDefault(s.Pack, "general")); err != nil {
			return fmt.Errorf("seed statement %s: %w", s.ID, err)
		}
	}
	return nil
}

func (db *DB) seedAlias(ctx context.Context) error {
	empty, err := db.tableEmpty(ctx, "alias_cards")
	if err != nil || !empty {
		return err
	}
	var items []game.AliasCard
	if err := json.Unmarshal(seedAlias, &items); err != nil {
		return fmt.Errorf("parse alias seed: %w", err)
	}
	for _, c := range items {
		taboo, _ := json.Marshal(orEmptyStr(c.Taboo))
		if _, err := db.pool.Exec(ctx,
			`INSERT INTO alias_cards (id, word, taboo, pack)
			 VALUES ($1,$2,$3,$4) ON CONFLICT (id) DO NOTHING`,
			c.ID, c.Word, taboo, orDefault(c.Pack, "general")); err != nil {
			return fmt.Errorf("seed alias %s: %w", c.ID, err)
		}
	}
	return nil
}

func (db *DB) seedCrocodile(ctx context.Context) error {
	empty, err := db.tableEmpty(ctx, "crocodile_puzzles")
	if err != nil || !empty {
		return err
	}
	var items []game.CrocodilePuzzle
	if err := json.Unmarshal(seedCrocodile, &items); err != nil {
		return fmt.Errorf("parse crocodile seed: %w", err)
	}
	for _, p := range items {
		if _, err := db.pool.Exec(ctx,
			`INSERT INTO crocodile_puzzles (id, emoji, answer, hint, pack)
			 VALUES ($1,$2,$3,$4,$5) ON CONFLICT (id) DO NOTHING`,
			p.ID, p.Emoji, p.Answer, p.Hint, orDefault(p.Pack, "general")); err != nil {
			return fmt.Errorf("seed crocodile %s: %w", p.ID, err)
		}
	}
	return nil
}

func orDefault(v, def string) string {
	if v == "" {
		return def
	}
	return v
}

func orEmptyStr(s []string) []string {
	if s == nil {
		return []string{}
	}
	return s
}

func orEmptyPhrases(p [][]string) [][]string {
	if p == nil {
		return [][]string{}
	}
	return p
}
