package api

import (
	"GopherAgent/utility"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"time"

	"github.com/gogf/gf/v2/net/ghttp"

	"GopherAgent/internal/consts"
	"GopherAgent/internal/logic/config"
	"GopherAgent/internal/logic/redisx"
)

const (
	authCookieName  = "gopher_auth_token"
	authTokenPrefix = "gopher:"
	bearerPrefix    = "Bearer "
)

func authEnabled() bool {
	return config.C().GetString(consts.CfgWebPassword) != ""
}

func authToken(password string) string {
	sum := sha256.Sum256([]byte(authTokenPrefix + password))
	return hex.EncodeToString(sum[:])
}

// Login brute-force guard: at most loginMaxFailures wrong passwords per client
// IP within loginFailTTL. Backed by Redis; a no-op when Redis is disabled.
const (
	loginFailTTL     = 10 * time.Minute
	loginMaxFailures = 5
)

func loginFailKey(ip string) string { return redisx.Key("login", "fail", ip) }

func loginBlocked(ctx context.Context, ip string) bool {
	rdb := redisx.Client()
	if rdb == nil || ip == "" {
		return false
	}
	n, err := rdb.Get(ctx, loginFailKey(ip)).Int()
	if err != nil {
		return false
	}
	return n >= loginMaxFailures
}

func noteLoginFailure(ctx context.Context, ip string) {
	rdb := redisx.Client()
	if rdb == nil || ip == "" {
		return
	}
	key := loginFailKey(ip)
	pipe := rdb.Pipeline()
	pipe.Incr(ctx, key)
	pipe.Expire(ctx, key, loginFailTTL)
	_, _ = pipe.Exec(ctx)
}

func clearLoginFailures(ctx context.Context, ip string) {
	rdb := redisx.Client()
	if rdb == nil || ip == "" {
		return
	}
	_ = rdb.Del(ctx, loginFailKey(ip)).Err()
}

func authValid(r *ghttp.Request) bool {
	if !authEnabled() {
		return true
	}
	expected := authToken(config.C().GetString(consts.CfgWebPassword))
	if token := r.Cookie.Get(authCookieName).String(); token == expected {
		return true
	}
	header := r.Header.Get("Authorization")
	if len(header) > len(bearerPrefix) && header[:len(bearerPrefix)] == bearerPrefix && header[len(bearerPrefix):] == expected {
		return true
	}
	return false
}

// AuthCheck reports whether authentication is required and satisfied.
func AuthCheck(r *ghttp.Request) {
	if !authEnabled() {
		writeJSON(r, map[string]interface{}{
			"status": consts.StatusSuccess, "auth_required": false, "enabled": false, "authenticated": true,
		})
		return
	}
	writeJSON(r, map[string]interface{}{
		"status":        consts.StatusSuccess,
		"auth_required": true,
		"enabled":       true,
		"authenticated": authValid(r),
	})
}

// AuthLogin validates the console password.
func AuthLogin(r *ghttp.Request) {
	if !authEnabled() {
		writeJSON(r, map[string]interface{}{"status": consts.StatusSuccess, "ok": true})
		return
	}
	var body struct {
		Password string `json:"password"`
	}
	_ = parseBody(r, &body)

	ip := r.GetClientIp()
	if loginBlocked(r.Context(), ip) {
		writeJSON(r, map[string]interface{}{"status": consts.StatusError, "ok": false, "error": "Too many failed attempts, try again later"})
		return
	}

	expected := config.C().GetString(consts.CfgWebPassword)
	if utility.MD5WithSalt(body.Password, consts.PasswordSalt) != expected {
		noteLoginFailure(r.Context(), ip)
		writeJSON(r, map[string]interface{}{"status": consts.StatusError, "ok": false, "error": "Wrong password"})
		return
	}
	clearLoginFailures(r.Context(), ip)
	token := authToken(expected)
	cookie := &http.Cookie{
		Name:     authCookieName,
		Value:    token,
		Path:     "/",
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
	}
	r.Response.Header().Add("Set-Cookie", cookie.String())
	writeJSON(r, map[string]interface{}{"status": consts.StatusSuccess, "ok": true, "token": token})
}

// AuthLogout clears the auth cookie.
func AuthLogout(r *ghttp.Request) {
	cookie := &http.Cookie{Name: authCookieName, Value: "", Path: "/", MaxAge: -1}
	r.Response.Header().Add("Set-Cookie", cookie.String())
	writeJSON(r, map[string]interface{}{"status": consts.StatusSuccess})
}

// Version reports the backend version.
func Version(r *ghttp.Request) {
	writeJSON(r, map[string]interface{}{"status": consts.StatusSuccess, "version": VersionString})
}

// VersionString is the reported backend version.
var VersionString = "0.2.0"

// requireAuth guards a handler when a console password is configured.
func requireAuth(r *ghttp.Request) bool {
	if authValid(r) {
		return true
	}
	r.Response.WriteStatus(http.StatusUnauthorized)
	fail(r, "authentication required")
	return false
}
