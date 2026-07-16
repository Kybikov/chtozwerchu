package config

import "os"

// Config holds runtime configuration read from the environment.
type Config struct {
	Port        string
	DatabaseURL string
	RedisURL    string
	WebDir      string
	PublicURL   string
	JWTSecret   string
}

// Load reads configuration from environment variables with sensible defaults
// for local development. DATABASE_URL and REDIS_URL honour an explicit empty
// value (var set to "") as "disabled"; only an unset var falls back to the
// default.
func Load() Config {
	return Config{
		Port:        env("PORT", "3000"),
		DatabaseURL: envSet("DATABASE_URL", "postgres://khz:khz@localhost:5432/khz?sslmode=disable"),
		RedisURL:    envSet("REDIS_URL", "redis://localhost:6379/0"),
		WebDir:      env("WEB_DIR", "./web"),
		PublicURL:   env("PUBLIC_URL", ""),
		JWTSecret:   env("JWT_SECRET", "dev-secret-change-me"),
	}
}

// env returns the value or def when the var is unset or empty.
func env(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

// envSet returns the value when the var is present (even if empty), otherwise def.
func envSet(key, def string) string {
	if v, ok := os.LookupEnv(key); ok {
		return v
	}
	return def
}
