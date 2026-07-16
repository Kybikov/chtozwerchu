package store

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
)

// ErrNotFound is returned when a row does not exist.
var ErrNotFound = errors.New("not found")

// User is a registered account.
type User struct {
	ID          string    `json:"id"`
	Email       string    `json:"email"`
	DisplayName string    `json:"displayName"`
	CreatedAt   time.Time `json:"createdAt"`
}

func newID(prefix string) string {
	b := make([]byte, 12)
	_, _ = rand.Read(b)
	return prefix + hex.EncodeToString(b)
}

// CreateUser inserts a new user and returns it. Email must be unique.
func (db *DB) CreateUser(ctx context.Context, email, passHash, displayName string) (*User, error) {
	u := &User{
		ID:          newID("u-"),
		Email:       email,
		DisplayName: displayName,
		CreatedAt:   time.Now(),
	}
	_, err := db.pool.Exec(ctx,
		`INSERT INTO users (id, email, pass_hash, display_name, created_at)
		 VALUES ($1,$2,$3,$4,$5)`,
		u.ID, u.Email, passHash, u.DisplayName, u.CreatedAt)
	if err != nil {
		return nil, err
	}
	return u, nil
}

// UserByEmail returns the user and its password hash.
func (db *DB) UserByEmail(ctx context.Context, email string) (*User, string, error) {
	var u User
	var hash string
	err := db.pool.QueryRow(ctx,
		`SELECT id, email, display_name, created_at, pass_hash FROM users WHERE email = $1`,
		email).Scan(&u.ID, &u.Email, &u.DisplayName, &u.CreatedAt, &hash)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, "", ErrNotFound
	}
	if err != nil {
		return nil, "", err
	}
	return &u, hash, nil
}

// UserByID returns a user by id.
func (db *DB) UserByID(ctx context.Context, id string) (*User, error) {
	var u User
	err := db.pool.QueryRow(ctx,
		`SELECT id, email, display_name, created_at FROM users WHERE id = $1`,
		id).Scan(&u.ID, &u.Email, &u.DisplayName, &u.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return &u, nil
}

// MatchPlayer is a player row saved with a finished match.
type MatchPlayer struct {
	UserID *string `json:"userId"`
	Name   string  `json:"name"`
	Team   string  `json:"team"`
	Score  int     `json:"score"`
}

// SaveMatch persists a finished match and its players.
func (db *DB) SaveMatch(ctx context.Context, code string, config any, winner string, players []MatchPlayer) error {
	cfg, _ := json.Marshal(config)
	id := newID("m-")
	now := time.Now()
	tx, err := db.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx,
		`INSERT INTO matches (id, code, config, started_at, ended_at, winner)
		 VALUES ($1,$2,$3,$4,$5,$6)`,
		id, code, cfg, now, now, winner); err != nil {
		return err
	}
	for _, p := range players {
		if _, err := tx.Exec(ctx,
			`INSERT INTO match_players (match_id, user_id, name, team, score)
			 VALUES ($1,$2,$3,$4,$5)`,
			id, p.UserID, p.Name, p.Team, p.Score); err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}

// MatchSummary is a row in a user's match history.
type MatchSummary struct {
	Code    string    `json:"code"`
	Winner  string    `json:"winner"`
	Team    string    `json:"team"`
	Score   int       `json:"score"`
	Won     bool      `json:"won"`
	EndedAt time.Time `json:"endedAt"`
}

// UserHistory returns a user's recent matches, newest first.
func (db *DB) UserHistory(ctx context.Context, userID string, limit int) ([]MatchSummary, error) {
	if limit <= 0 || limit > 100 {
		limit = 30
	}
	rows, err := db.pool.Query(ctx,
		`SELECT m.code, m.winner, mp.team, mp.score, m.ended_at
		   FROM match_players mp
		   JOIN matches m ON m.id = mp.match_id
		  WHERE mp.user_id = $1
		  ORDER BY m.ended_at DESC
		  LIMIT $2`,
		userID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []MatchSummary
	for rows.Next() {
		var s MatchSummary
		if err := rows.Scan(&s.Code, &s.Winner, &s.Team, &s.Score, &s.EndedAt); err != nil {
			return nil, err
		}
		s.Won = s.Winner == s.Team
		out = append(out, s)
	}
	return out, rows.Err()
}

// UserStats aggregates a user's play record.
type UserStats struct {
	Matches int `json:"matches"`
	Wins    int `json:"wins"`
	Points  int `json:"points"`
}

// StatsForUser returns aggregate stats for a user.
func (db *DB) StatsForUser(ctx context.Context, userID string) (UserStats, error) {
	var st UserStats
	err := db.pool.QueryRow(ctx,
		`SELECT count(*),
		        coalesce(sum(CASE WHEN m.winner = mp.team THEN 1 ELSE 0 END), 0),
		        coalesce(sum(mp.score), 0)
		   FROM match_players mp
		   JOIN matches m ON m.id = mp.match_id
		  WHERE mp.user_id = $1`,
		userID).Scan(&st.Matches, &st.Wins, &st.Points)
	return st, err
}
