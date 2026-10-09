// Package redisx owns the process-wide Redis client.
//
// Redis is optional. When it is disabled in configuration (or unreachable at
// startup) every accessor returns nil/empty and the callers fall back to their
// in-process implementations, so a single-node deployment keeps working with no
// Redis at all.
package redisx

import (
	"context"
	"fmt"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/redis/go-redis/v9"

	"GopherAgent/internal/consts"
	"GopherAgent/internal/logic/config"
)

const defaultPrefix = "gopher:"

var (
	mu      sync.RWMutex
	client  *redis.Client
	enabled bool
	prefix  = defaultPrefix
	addr    string
)

// Init builds the client from configuration and verifies connectivity. A failed
// ping leaves Redis disabled so callers fall back to memory; the returned error
// is informational. Safe to call more than once.
//
// Environment variables override the config store so secrets (the password in
// particular) never have to live in a committed file:
//
//	GOPHER_REDIS_ENABLED, GOPHER_REDIS_ADDR, GOPHER_REDIS_PASSWORD,
//	GOPHER_REDIS_DB, GOPHER_REDIS_PREFIX
func Init(ctx context.Context) error {
	cfg := config.C()

	on := envBool("GOPHER_REDIS_ENABLED", cfg.GetBool(consts.CfgRedisEnabled))
	effAddr := envStr("GOPHER_REDIS_ADDR", cfg.GetString(consts.CfgRedisAddr))
	password := envStr("GOPHER_REDIS_PASSWORD", cfg.GetString(consts.CfgRedisPassword))
	db := envInt("GOPHER_REDIS_DB", cfg.GetInt(consts.CfgRedisDB, 0))
	effPrefix := envStr("GOPHER_REDIS_PREFIX", cfg.GetString(consts.CfgRedisPrefix))
	if effPrefix == "" {
		effPrefix = defaultPrefix
	}

	mu.Lock()
	defer mu.Unlock()

	// Tear down any previous client (config reload).
	if client != nil {
		_ = client.Close()
		client = nil
	}
	enabled = false
	prefix = effPrefix
	addr = effAddr

	if !on || effAddr == "" {
		return nil
	}

	c := redis.NewClient(&redis.Options{
		Addr:     effAddr,
		Password: password,
		DB:       db,
	})

	pingCtx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	if err := c.Ping(pingCtx).Err(); err != nil {
		_ = c.Close()
		return fmt.Errorf("redis ping %s failed: %w", effAddr, err)
	}

	client = c
	enabled = true
	return nil
}

func envStr(key, def string) string {
	if v, ok := os.LookupEnv(key); ok {
		return strings.TrimSpace(v)
	}
	return strings.TrimSpace(def)
}

func envBool(key string, def bool) bool {
	v, ok := os.LookupEnv(key)
	if !ok {
		return def
	}
	switch strings.ToLower(strings.TrimSpace(v)) {
	case "1", "true", "yes", "on":
		return true
	case "0", "false", "no", "off":
		return false
	default:
		return def
	}
}

func envInt(key string, def int) int {
	v, ok := os.LookupEnv(key)
	if !ok {
		return def
	}
	if n, err := strconv.Atoi(strings.TrimSpace(v)); err == nil {
		return n
	}
	return def
}

// Close releases the client. Used on shutdown/tests.
func Close() {
	mu.Lock()
	defer mu.Unlock()
	if client != nil {
		_ = client.Close()
		client = nil
	}
	enabled = false
}

// Client returns the shared client, or nil when Redis is disabled/unavailable.
func Client() *redis.Client {
	mu.RLock()
	defer mu.RUnlock()
	return client
}

// SetClient installs c as the shared client (prefix keeps its current value).
// Intended for tests and embedding; production code uses Init.
func SetClient(c *redis.Client) {
	mu.Lock()
	defer mu.Unlock()
	if client != nil && client != c {
		_ = client.Close()
	}
	client = c
	enabled = c != nil
}

// Enabled reports whether a live Redis client is configured.
func Enabled() bool {
	mu.RLock()
	defer mu.RUnlock()
	return enabled
}

// Prefix returns the configured key prefix (default "gopher:").
func Prefix() string {
	mu.RLock()
	defer mu.RUnlock()
	return prefix
}

// Addr returns the effective address Init resolved (env or config store).
func Addr() string {
	mu.RLock()
	defer mu.RUnlock()
	return addr
}

// SetPrefix overrides the key prefix (used by tests/tools).
func SetPrefix(p string) {
	if p == "" {
		p = defaultPrefix
	}
	mu.Lock()
	prefix = p
	mu.Unlock()
}

// Key joins the configured prefix with parts using ":".
func Key(parts ...string) string {
	return Prefix() + strings.Join(parts, ":")
}
