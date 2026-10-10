package web

import (
	"crypto/sha256"
	"crypto/subtle"
	"encoding/json"
	"net/http"
	"strings"
)

const csp = "default-src 'none'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; script-src 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; frame-ancestors 'none'; form-action 'self'"

func secure(w http.ResponseWriter, html bool) {
	h := w.Header()
	h.Set("Cache-Control", "no-store")
	h.Set("X-Content-Type-Options", "nosniff")
	h.Set("Referrer-Policy", "no-referrer")
	if html {
		h.Set("Content-Type", "text/html; charset=UTF-8")
		h.Set("X-Frame-Options", "DENY")
		h.Set("Content-Security-Policy", csp)
	} else {
		h.Set("Content-Type", "application/json; charset=UTF-8")
	}
}
func respond(w http.ResponseWriter, status int, payload any) {
	secure(w, false)
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(payload)
}
func failure(w http.ResponseWriter, status int, code, message string) {
	respond(w, status, map[string]any{"success": false, "error": code, "message": message})
}
func equal(value, expected string) bool {
	if value == "" || expected == "" {
		return false
	}
	a, b := sha256.Sum256([]byte(value)), sha256.Sum256([]byte(expected))
	return subtle.ConstantTimeCompare(a[:], b[:]) == 1
}
func authorize(w http.ResponseWriter, r *http.Request, expected string) bool {
	if expected == "" {
		failure(w, 503, "admin_auth_not_configured", "Administrative routes are disabled.")
		return false
	}
	header := r.Header.Get("Authorization")
	if !strings.HasPrefix(header, "Bearer ") || !equal(strings.TrimPrefix(header, "Bearer "), expected) {
		failure(w, 401, "unauthorized", "A valid Bearer token is required.")
		return false
	}
	return true
}
func method(w http.ResponseWriter, r *http.Request, allowed ...string) bool {
	for _, v := range allowed {
		if r.Method == v {
			return true
		}
	}
	w.Header().Set("Allow", strings.Join(allowed, ", "))
	failure(w, 405, "method_not_allowed", "Use "+strings.Join(allowed, " or ")+".")
	return false
}
