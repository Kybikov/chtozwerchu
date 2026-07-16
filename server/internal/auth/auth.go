// Package auth provides password hashing and stateless HMAC session tokens.
package auth

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"strconv"
	"strings"
	"time"

	"golang.org/x/crypto/bcrypt"
)

// HashPassword returns a bcrypt hash of the password.
func HashPassword(pw string) (string, error) {
	b, err := bcrypt.GenerateFromPassword([]byte(pw), bcrypt.DefaultCost)
	return string(b), err
}

// CheckPassword reports whether pw matches the bcrypt hash.
func CheckPassword(hash, pw string) bool {
	return bcrypt.CompareHashAndPassword([]byte(hash), []byte(pw)) == nil
}

var b64 = base64.RawURLEncoding

// Sign issues a stateless token "payload.sig" where payload = userID|expUnix.
func Sign(secret, userID string, ttl time.Duration) string {
	exp := time.Now().Add(ttl).Unix()
	payload := userID + "|" + strconv.FormatInt(exp, 10)
	msg := b64.EncodeToString([]byte(payload))
	return msg + "." + b64.EncodeToString(mac(secret, msg))
}

// Verify validates a token and returns its userID.
func Verify(secret, token string) (string, error) {
	parts := strings.SplitN(token, ".", 2)
	if len(parts) != 2 {
		return "", errors.New("malformed token")
	}
	msg, sig := parts[0], parts[1]
	want, err := b64.DecodeString(sig)
	if err != nil || !hmac.Equal(want, mac(secret, msg)) {
		return "", errors.New("bad signature")
	}
	raw, err := b64.DecodeString(msg)
	if err != nil {
		return "", errors.New("bad payload")
	}
	fields := strings.SplitN(string(raw), "|", 2)
	if len(fields) != 2 {
		return "", errors.New("bad payload")
	}
	exp, err := strconv.ParseInt(fields[1], 10, 64)
	if err != nil || time.Now().Unix() > exp {
		return "", errors.New("expired")
	}
	return fields[0], nil
}

func mac(secret, msg string) []byte {
	h := hmac.New(sha256.New, []byte(secret))
	h.Write([]byte(msg))
	return h.Sum(nil)
}
