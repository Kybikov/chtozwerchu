package store

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
)

func sessionDigest(token string) string {
	d := sha256.Sum256([]byte(token))
	return hex.EncodeToString(d[:])
}
func (db *DB) CreateSession(ctx context.Context, userID, token string, expires time.Time) error {
	tx, err := db.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if _, err = tx.Exec(ctx, `DELETE FROM auth_sessions WHERE expires_at <= now()`); err != nil {
		return err
	}
	if _, err = tx.Exec(ctx, `INSERT INTO auth_sessions(digest,user_id,expires_at) VALUES($1,$2,$3)`, sessionDigest(token), userID, expires); err != nil {
		return err
	}
	if _, err = tx.Exec(ctx, `DELETE FROM auth_sessions WHERE digest IN (SELECT digest FROM auth_sessions WHERE user_id=$1 ORDER BY created_at DESC OFFSET 20)`, userID); err != nil {
		return err
	}
	return tx.Commit(ctx)
}
func (db *DB) SessionUser(ctx context.Context, token string) (*User, error) {
	var u User
	err := db.pool.QueryRow(ctx, `SELECT u.id,u.email,u.display_name,u.created_at FROM auth_sessions s JOIN users u ON u.id=s.user_id WHERE s.digest=$1 AND s.expires_at>now()`, sessionDigest(token)).Scan(&u.ID, &u.Email, &u.DisplayName, &u.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return &u, nil
}
func (db *DB) DeleteSession(ctx context.Context, token string) error {
	_, err := db.pool.Exec(ctx, `DELETE FROM auth_sessions WHERE digest=$1`, sessionDigest(token))
	return err
}

type StudioMatch struct {
	ID       string          `json:"id"`
	Code     string          `json:"code"`
	Mode     string          `json:"mode"`
	Snapshot json.RawMessage `json:"snapshot"`
	EndedAt  time.Time       `json:"endedAt"`
}

func (db *DB) SaveStudioMatch(ctx context.Context, ownerID, matchKey, code, mode string, snapshot any) error {
	b, err := json.Marshal(snapshot)
	if err != nil {
		return err
	}
	digest := sha256.Sum256([]byte(ownerID + "|" + matchKey))
	id := "show-" + hex.EncodeToString(digest[:])
	_, err = db.pool.Exec(ctx, `INSERT INTO studio_matches(id,owner_id,code,mode,snapshot) VALUES($1,$2,$3,$4,$5) ON CONFLICT(id) DO NOTHING`, id, ownerID, code, mode, b)
	return err
}
func (db *DB) StudioHistory(ctx context.Context, ownerID string) ([]StudioMatch, error) {
	rows, err := db.pool.Query(ctx, `SELECT id,code,mode,snapshot,ended_at FROM studio_matches WHERE owner_id=$1 ORDER BY ended_at DESC LIMIT 50`, ownerID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []StudioMatch{}
	for rows.Next() {
		var item StudioMatch
		if err := rows.Scan(&item.ID, &item.Code, &item.Mode, &item.Snapshot, &item.EndedAt); err != nil {
			return nil, err
		}
		out = append(out, item)
	}
	return out, rows.Err()
}
