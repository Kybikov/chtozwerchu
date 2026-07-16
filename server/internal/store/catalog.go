package store

import (
	"context"
	"encoding/json"

	"chtozverchu/internal/game"
)

// Catalog is an in-memory snapshot of playable content that implements
// game.Catalog. Content is small, so it is loaded once at startup.
type Catalog struct {
	songs      []game.Song
	statements []game.Statement
	alias      []game.AliasCard
	crocodile  []game.CrocodilePuzzle
}

// EmbeddedCatalog builds a catalog directly from the bundled seed files, with
// no database. Used for local development and DB-less deployments.
func EmbeddedCatalog() (*Catalog, error) {
	c := &Catalog{}
	var songs []seedSong
	if err := json.Unmarshal(seedSongs, &songs); err != nil {
		return nil, err
	}
	for _, s := range songs {
		c.songs = append(c.songs, game.Song{
			ID:      s.ID,
			Title:   s.Title,
			Artist:  s.Artist,
			Pack:    orDefault(s.Pack, "ua"),
			Era:     s.Era,
			Aliases: s.Aliases,
			Phrases: s.Phrases,
		})
	}
	if err := json.Unmarshal(seedStatements, &c.statements); err != nil {
		return nil, err
	}
	if err := json.Unmarshal(seedAlias, &c.alias); err != nil {
		return nil, err
	}
	if err := json.Unmarshal(seedCrocodile, &c.crocodile); err != nil {
		return nil, err
	}
	return c, nil
}

// LoadCatalog reads all content tables into memory.
func (db *DB) LoadCatalog(ctx context.Context) (*Catalog, error) {
	c := &Catalog{}

	rows, err := db.pool.Query(ctx, `SELECT id, title, artist, pack, era, aliases, phrases, preview_url, youtube FROM songs`)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var s game.Song
		var aliases, phrases []byte
		if err := rows.Scan(&s.ID, &s.Title, &s.Artist, &s.Pack, &s.Era, &aliases, &phrases, &s.PreviewURL, &s.YouTube); err != nil {
			rows.Close()
			return nil, err
		}
		_ = json.Unmarshal(aliases, &s.Aliases)
		_ = json.Unmarshal(phrases, &s.Phrases)
		c.songs = append(c.songs, s)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}

	srows, err := db.pool.Query(ctx, `SELECT id, text, truth, fact, pack FROM statements`)
	if err != nil {
		return nil, err
	}
	for srows.Next() {
		var s game.Statement
		if err := srows.Scan(&s.ID, &s.Text, &s.Truth, &s.Fact, &s.Pack); err != nil {
			srows.Close()
			return nil, err
		}
		c.statements = append(c.statements, s)
	}
	srows.Close()

	arows, err := db.pool.Query(ctx, `SELECT id, word, taboo, pack FROM alias_cards`)
	if err != nil {
		return nil, err
	}
	for arows.Next() {
		var a game.AliasCard
		var taboo []byte
		if err := arows.Scan(&a.ID, &a.Word, &taboo, &a.Pack); err != nil {
			arows.Close()
			return nil, err
		}
		_ = json.Unmarshal(taboo, &a.Taboo)
		c.alias = append(c.alias, a)
	}
	arows.Close()

	crows, err := db.pool.Query(ctx, `SELECT id, emoji, answer, hint, pack FROM crocodile_puzzles`)
	if err != nil {
		return nil, err
	}
	for crows.Next() {
		var p game.CrocodilePuzzle
		if err := crows.Scan(&p.ID, &p.Emoji, &p.Answer, &p.Hint, &p.Pack); err != nil {
			crows.Close()
			return nil, err
		}
		c.crocodile = append(c.crocodile, p)
	}
	crows.Close()

	return c, nil
}

// Songs returns songs for a preset; unknown/empty presets return everything.
func (c *Catalog) Songs(preset string) []game.Song {
	if preset == "" || preset == "all" || preset == "party" {
		return c.songs
	}
	var out []game.Song
	for _, s := range c.songs {
		if s.Pack == preset || s.Era == preset {
			out = append(out, s)
		}
	}
	if len(out) == 0 {
		return c.songs
	}
	return out
}

func (c *Catalog) Statements(pack string) []game.Statement {
	if pack == "" {
		return c.statements
	}
	return filterStatements(c.statements, pack)
}

func (c *Catalog) AliasCards(pack string) []game.AliasCard {
	if pack == "" {
		return c.alias
	}
	var out []game.AliasCard
	for _, a := range c.alias {
		if a.Pack == pack {
			out = append(out, a)
		}
	}
	return out
}

func (c *Catalog) CrocodilePuzzles(pack string) []game.CrocodilePuzzle {
	if pack == "" {
		return c.crocodile
	}
	var out []game.CrocodilePuzzle
	for _, p := range c.crocodile {
		if p.Pack == pack {
			out = append(out, p)
		}
	}
	return out
}

func filterStatements(in []game.Statement, pack string) []game.Statement {
	var out []game.Statement
	for _, s := range in {
		if s.Pack == pack {
			out = append(out, s)
		}
	}
	return out
}

// Presets returns the available playlist presets derived from song packs/eras.
func (c *Catalog) Presets() []map[string]any {
	packs := map[string]int{}
	for _, s := range c.songs {
		packs[s.Pack]++
	}
	presets := []map[string]any{{"id": "party", "name": "Все підряд", "count": len(c.songs)}}
	for pack, n := range packs {
		presets = append(presets, map[string]any{"id": pack, "name": pack, "count": n})
	}
	return presets
}
