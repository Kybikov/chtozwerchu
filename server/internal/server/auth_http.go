package server

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgconn"

	"chtozverchu/internal/auth"
	"chtozverchu/internal/store"
)

const tokenTTL = 30 * 24 * time.Hour

func (s *Server) registerAuthRoutes(mux *http.ServeMux) {
	mux.HandleFunc("/api/auth/register", s.register)
	mux.HandleFunc("/api/auth/login", s.login)
	mux.HandleFunc("/api/me", s.me)
	mux.HandleFunc("/api/me/history", s.history)
}

type authReq struct {
	Email       string `json:"email"`
	Password    string `json:"password"`
	DisplayName string `json:"displayName"`
}

type authResp struct {
	Token string      `json:"token"`
	User  *store.User `json:"user"`
}

func (s *Server) register(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSON(w, http.StatusMethodNotAllowed, errBody("метод не підтримується"))
		return
	}
	if s.db == nil {
		writeJSON(w, http.StatusServiceUnavailable, errBody("реєстрація недоступна без бази даних"))
		return
	}
	var req authReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, errBody("некоректний запит"))
		return
	}
	req.Email = strings.ToLower(strings.TrimSpace(req.Email))
	name := strings.TrimSpace(req.DisplayName)
	if !strings.Contains(req.Email, "@") || len(req.Password) < 6 {
		writeJSON(w, http.StatusBadRequest, errBody("вкажи email і пароль (мін. 6 символів)"))
		return
	}
	if name == "" {
		name = req.Email[:strings.Index(req.Email, "@")]
	}
	hash, err := auth.HashPassword(req.Password)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, errBody("не вдалося зашифрувати пароль"))
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	user, err := s.db.CreateUser(ctx, req.Email, hash, name)
	if err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "23505" {
			writeJSON(w, http.StatusConflict, errBody("такий email вже зареєстрований"))
			return
		}
		writeJSON(w, http.StatusInternalServerError, errBody("не вдалося створити акаунт"))
		return
	}
	writeJSON(w, http.StatusOK, authResp{Token: s.token(user.ID), User: user})
}

func (s *Server) login(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSON(w, http.StatusMethodNotAllowed, errBody("метод не підтримується"))
		return
	}
	if s.db == nil {
		writeJSON(w, http.StatusServiceUnavailable, errBody("вхід недоступний без бази даних"))
		return
	}
	var req authReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, errBody("некоректний запит"))
		return
	}
	req.Email = strings.ToLower(strings.TrimSpace(req.Email))
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	user, hash, err := s.db.UserByEmail(ctx, req.Email)
	if err != nil || !auth.CheckPassword(hash, req.Password) {
		writeJSON(w, http.StatusUnauthorized, errBody("невірний email або пароль"))
		return
	}
	writeJSON(w, http.StatusOK, authResp{Token: s.token(user.ID), User: user})
}

func (s *Server) me(w http.ResponseWriter, r *http.Request) {
	user := s.userFromRequest(r)
	if user == nil {
		writeJSON(w, http.StatusUnauthorized, errBody("не авторизовано"))
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	stats, _ := s.db.StatsForUser(ctx, user.ID)
	writeJSON(w, http.StatusOK, map[string]any{"user": user, "stats": stats})
}

func (s *Server) history(w http.ResponseWriter, r *http.Request) {
	user := s.userFromRequest(r)
	if user == nil {
		writeJSON(w, http.StatusUnauthorized, errBody("не авторизовано"))
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	items, err := s.db.UserHistory(ctx, user.ID, 30)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, errBody("не вдалося завантажити історію"))
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"matches": items})
}

// token issues a signed session token for a user id.
func (s *Server) token(userID string) string {
	return auth.Sign(s.cfg.JWTSecret, userID, tokenTTL)
}

// userFromRequest resolves the bearer token to a user, or nil.
func (s *Server) userFromRequest(r *http.Request) *store.User {
	if s.db == nil {
		return nil
	}
	tok := bearer(r)
	if tok == "" {
		return nil
	}
	id, err := auth.Verify(s.cfg.JWTSecret, tok)
	if err != nil {
		return nil
	}
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	user, err := s.db.UserByID(ctx, id)
	if err != nil {
		return nil
	}
	return user
}

func bearer(r *http.Request) string {
	h := r.Header.Get("Authorization")
	if strings.HasPrefix(h, "Bearer ") {
		return strings.TrimSpace(h[7:])
	}
	return ""
}

func errBody(msg string) map[string]string { return map[string]string{"error": msg} }
