package server

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net"
	"net/http"
	"net/mail"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"chtozverchu/internal/auth"
	"chtozverchu/internal/store"
	"github.com/jackc/pgx/v5/pgconn"
)

const tokenTTL = 30 * 24 * time.Hour
const sessionCookie = "khz_session"

var passwordWorkers = make(chan struct{}, 4)
var authAttempts = struct {
	sync.Mutex
	entries map[string][]time.Time
}{entries: map[string][]time.Time{}}
var missingUserHash = func() string { h, _ := auth.HashPassword("not-a-real-account-password"); return h }()

func (s *Server) registerAuthRoutes(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/auth/status", func(w http.ResponseWriter, r *http.Request) {
		authNoCache(w)
		writeJSON(w, 200, map[string]any{"available": s.db != nil, "session": "cookie"})
	})
	mux.HandleFunc("/api/auth/register", s.register)
	mux.HandleFunc("/api/auth/login", s.login)
	mux.HandleFunc("POST /api/auth/logout", s.logout)
	mux.HandleFunc("GET /api/me", s.me)
	mux.HandleFunc("GET /api/me/history", s.history)
	mux.HandleFunc("GET /api/me/shows", s.showHistory)
	mux.HandleFunc("POST /api/me/shows", s.saveLocalShow)
}

type authReq struct {
	Email       string `json:"email"`
	Password    string `json:"password"`
	DisplayName string `json:"displayName"`
}
type authResp struct {
	Token string      `json:"token,omitempty"`
	User  *store.User `json:"user"`
}

func authNoCache(w http.ResponseWriter) { w.Header().Set("Cache-Control", "no-store") }
func authKey(r *http.Request, email string) string {
	ip, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		ip = r.RemoteAddr
	}
	return ip + "|" + email
}
func allowAuth(key string) bool {
	authAttempts.Lock()
	defer authAttempts.Unlock()
	now := time.Now()
	list := authAttempts.entries[key]
	fresh := list[:0]
	for _, v := range list {
		if now.Sub(v) < time.Minute {
			fresh = append(fresh, v)
		}
	}
	if len(fresh) >= 10 {
		return false
	}
	if len(authAttempts.entries) > 4096 {
		for k, v := range authAttempts.entries {
			if len(v) == 0 || now.Sub(v[len(v)-1]) > time.Minute {
				delete(authAttempts.entries, k)
			}
		}
		if len(authAttempts.entries) > 4096 {
			return false
		}
	}
	authAttempts.entries[key] = append(fresh, now)
	return true
}
func clearAuthAttempts(key string) {
	authAttempts.Lock()
	delete(authAttempts.entries, key)
	authAttempts.Unlock()
}
func validAccount(req authReq) string {
	address, err := mail.ParseAddress(req.Email)
	if err != nil || address.Address != req.Email || len(req.Email) > 254 {
		return "Вкажи коректну адресу електронної пошти."
	}
	if utf8.RuneCountInString(req.Password) < 10 || len(req.Password) > 72 {
		return "Пароль має містити щонайменше 10 символів і не перевищувати 72 байти."
	}
	if utf8.RuneCountInString(strings.TrimSpace(req.DisplayName)) < 2 || utf8.RuneCountInString(req.DisplayName) > 32 {
		return "Ім’я має містити від 2 до 32 символів."
	}
	return ""
}
func (s *Server) authInput(w http.ResponseWriter, r *http.Request) (authReq, bool) {
	authNoCache(w)
	if r.Method != http.MethodPost {
		writeJSON(w, 405, errBody("Метод не підтримується."))
		return authReq{}, false
	}
	if !studioOrigin(r) {
		writeJSON(w, 403, errBody("Недозволене джерело запиту."))
		return authReq{}, false
	}
	if s.db == nil {
		writeJSON(w, 503, errBody("Акаунти зараз недоступні. Можна продовжити як гість."))
		return authReq{}, false
	}
	var req authReq
	if json.NewDecoder(http.MaxBytesReader(w, r.Body, 8192)).Decode(&req) != nil {
		writeJSON(w, 400, errBody("Не вдалося прочитати форму. Перевір дані."))
		return req, false
	}
	req.Email = strings.ToLower(strings.TrimSpace(req.Email))
	req.DisplayName = strings.TrimSpace(req.DisplayName)
	if !allowAuth(authKey(r, req.Email)) {
		w.Header().Set("Retry-After", "60")
		writeJSON(w, 429, errBody("Забагато спроб. Зачекай хвилину й спробуй ще раз."))
		return req, false
	}
	return req, true
}
func acquirePasswordWorker(w http.ResponseWriter) bool {
	select {
	case passwordWorkers <- struct{}{}:
		return true
	default:
		writeJSON(w, 503, errBody("Зараз багато входів. Спробуй за кілька секунд."))
		return false
	}
}
func (s *Server) register(w http.ResponseWriter, r *http.Request) {
	req, ok := s.authInput(w, r)
	if !ok {
		return
	}
	if message := validAccount(req); message != "" {
		writeJSON(w, 400, errBody(message))
		return
	}
	if !acquirePasswordWorker(w) {
		return
	}
	defer func() { <-passwordWorkers }()
	hash, err := auth.HashPassword(req.Password)
	if err != nil {
		writeJSON(w, 500, errBody("Не вдалося створити акаунт. Спробуй ще раз."))
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	user, err := s.db.CreateUser(ctx, req.Email, hash, req.DisplayName)
	if err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "23505" {
			writeJSON(w, 409, errBody("Цю пошту вже зареєстровано. Спробуй увійти."))
			return
		}
		writeJSON(w, 503, errBody("Не вдалося зберегти акаунт. Спробуй пізніше."))
		return
	}
	s.signIn(w, r, user)
}
func (s *Server) login(w http.ResponseWriter, r *http.Request) {
	req, ok := s.authInput(w, r)
	if !ok {
		return
	}
	if req.Email == "" || len(req.Email) > 254 || req.Password == "" || len(req.Password) > 72 {
		writeJSON(w, 400, errBody("Вкажи пошту й пароль."))
		return
	}
	if !acquirePasswordWorker(w) {
		return
	}
	defer func() { <-passwordWorkers }()
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	user, hash, err := s.db.UserByEmail(ctx, req.Email)
	if err != nil && !errors.Is(err, store.ErrNotFound) {
		writeJSON(w, 503, errBody("Вхід тимчасово недоступний. Спробуй пізніше."))
		return
	}
	if err != nil {
		auth.CheckPassword(missingUserHash, req.Password)
		writeJSON(w, 401, errBody("Неправильна пошта або пароль."))
		return
	}
	if !auth.CheckPassword(hash, req.Password) {
		writeJSON(w, 401, errBody("Неправильна пошта або пароль."))
		return
	}
	s.signIn(w, r, user)
}
func (s *Server) signIn(w http.ResponseWriter, r *http.Request, user *store.User) {
	random := make([]byte, 32)
	if _, err := rand.Read(random); err != nil {
		writeJSON(w, 500, errBody("Не вдалося відкрити сеанс."))
		return
	}
	token := base64.RawURLEncoding.EncodeToString(random)
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	expires := time.Now().Add(tokenTTL)
	if err := s.db.CreateSession(ctx, user.ID, token, expires); err != nil {
		writeJSON(w, 503, errBody("Акаунт доступний, але не вдалося відкрити сеанс. Спробуй увійти ще раз."))
		return
	}
	http.SetCookie(w, &http.Cookie{Name: sessionCookie, Value: token, Path: "/", HttpOnly: true, Secure: r.TLS != nil || strings.EqualFold(r.Header.Get("X-Forwarded-Proto"), "https"), SameSite: http.SameSiteLaxMode, MaxAge: int(tokenTTL.Seconds()), Expires: expires})
	clearAuthAttempts(authKey(r, user.Email))
	body := authResp{User: user}
	if r.Header.Get("X-KHZ-Client") != "studio" {
		body.Token = token
	}
	writeJSON(w, 200, body)
}
func (s *Server) logout(w http.ResponseWriter, r *http.Request) {
	authNoCache(w)
	if !studioOrigin(r) {
		writeJSON(w, 403, errBody("Недозволене джерело запиту."))
		return
	}
	token := ""
	if c, e := r.Cookie(sessionCookie); e == nil {
		token = c.Value
	}
	if token == "" {
		token = bearer(r)
	}
	if s.db != nil && token != "" {
		ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
		defer cancel()
		if err := s.db.DeleteSession(ctx, token); err != nil {
			writeJSON(w, 503, errBody("Не вдалося завершити сеанс. Спробуй ще раз."))
			return
		}
	}
	http.SetCookie(w, &http.Cookie{Name: sessionCookie, Value: "", Path: "/", MaxAge: -1, HttpOnly: true, Secure: r.TLS != nil || strings.EqualFold(r.Header.Get("X-Forwarded-Proto"), "https"), SameSite: http.SameSiteLaxMode})
	writeJSON(w, 200, map[string]bool{"ok": true})
}
func (s *Server) me(w http.ResponseWriter, r *http.Request) {
	authNoCache(w)
	user := s.userFromRequest(r)
	if user == nil {
		writeJSON(w, 401, errBody("Увійди в акаунт, щоб відкрити профіль."))
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	stats, err := s.db.StatsForUser(ctx, user.ID)
	if err != nil {
		writeJSON(w, 503, errBody("Не вдалося завантажити статистику. Спробуй ще раз."))
		return
	}
	writeJSON(w, 200, map[string]any{"user": user, "stats": stats})
}
func (s *Server) history(w http.ResponseWriter, r *http.Request) {
	authNoCache(w)
	user := s.userFromRequest(r)
	if user == nil {
		writeJSON(w, 401, errBody("Увійди, щоб переглянути історію."))
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	items, err := s.db.UserHistory(ctx, user.ID, 30)
	if err != nil {
		writeJSON(w, 503, errBody("Не вдалося завантажити історію."))
		return
	}
	if items == nil {
		items = []store.MatchSummary{}
	}
	writeJSON(w, 200, map[string]any{"matches": items})
}
func (s *Server) userFromRequest(r *http.Request) *store.User {
	if s.db == nil {
		return nil
	}
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	if c, err := r.Cookie(sessionCookie); err == nil && c.Value != "" {
		user, err := s.db.SessionUser(ctx, c.Value)
		if err == nil {
			return user
		}
	}
	token := bearer(r)
	if token == "" {
		return nil
	}
	if user, err := s.db.SessionUser(ctx, token); err == nil {
		return user
	}
	// Compatibility for bearer tokens issued by the original game. The new UI
	// uses revocable cookie sessions and receives no token in the response body.
	id, err := auth.Verify(s.cfg.JWTSecret, token)
	if err != nil {
		return nil
	}
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
