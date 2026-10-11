// Package config is a thin, typed facade over GoFrame's configuration system.
//
// All application settings live in a GoFrame config file (config.yaml). Reads go
// through g.Cfg(), with an environment variable named after the key in
// UPPER_SNAKE_CASE taking precedence (e.g. `web_port` -> WEB_PORT); writes go to
// GoFrame's in-memory adapter and are flushed back to the config file by Save.
package config

import (
	"context"
	"encoding/json"
	"os"
	"strings"
	"sync"

	"github.com/gogf/gf/v2/container/gvar"
	"github.com/gogf/gf/v2/frame/g"
	"github.com/gogf/gf/v2/os/gcfg"
	"github.com/gogf/gf/v2/os/gfile"
	"gopkg.in/yaml.v3"

	"GopherAgent/internal/consts"
	"GopherAgent/internal/store"
)

// Store is the process-wide configuration facade. Its public API is kept stable
// so callers do not depend on the underlying backend.
type Store struct {
	mu sync.RWMutex
}

var (
	storeInst *Store
	storeOnce sync.Once
)

// Init prepares the configuration facade. It is idempotent and never fails
// (GoFrame reads the config file lazily).
func Init() error {
	storeOnce.Do(func() {
		storeInst = &Store{}
		ensureConfigFile()
		migrateLegacy()
	})
	return nil
}

// ensureConfigFile seeds the GoFrame config file from the committed example when
// it is missing (fresh checkout), so defaults exist without being tracked.
func ensureConfigFile() {
	const example = "manifest/config/config.example.yaml"
	const target = "manifest/config/config.yaml"
	if gfile.Exists(target) || !gfile.Exists(example) {
		return
	}
	if raw := gfile.GetBytes(example); len(raw) > 0 {
		_ = gfile.PutBytes(target, raw)
	}
}

// migrateLegacy imports configuration previously stored in the SQLite `config`
// table into the GoFrame config file, so upgraded deployments keep their keys
// and secrets. It only fills keys the config file leaves blank.
func migrateLegacy() {
	rows, err := store.DB().GetAll(context.Background(), "SELECT k, v FROM "+consts.TableConfig)
	if err != nil || len(rows) == 0 {
		return
	}
	changed := false
	for _, row := range rows {
		key := row["k"].String()
		if key == "" {
			continue
		}
		var value interface{}
		if json.Unmarshal([]byte(row["v"].String()), &value) != nil {
			continue
		}
		if isBlank(value) || !isBlank(storeInst.Get(key)) {
			continue
		}
		storeInst.Set(key, value)
		changed = true
	}
	if changed {
		_ = storeInst.Save()
	}
}

// isBlank reports whether a configuration value is absent or empty.
func isBlank(v interface{}) bool {
	switch t := v.(type) {
	case nil:
		return true
	case string:
		return strings.TrimSpace(t) == ""
	case []interface{}:
		return len(t) == 0
	case map[string]interface{}:
		return len(t) == 0
	default:
		return false
	}
}

// C returns the process-wide configuration store, initialising it on demand.
func C() *Store {
	if storeInst == nil {
		_ = Init()
	}
	return storeInst
}

func bg() context.Context { return context.Background() }

func adapter() (*gcfg.AdapterFile, bool) {
	a, ok := g.Cfg().GetAdapter().(*gcfg.AdapterFile)
	return a, ok
}

// get resolves a key with an environment variable (UPPER_SNAKE_CASE of the key)
// taking precedence over the config file, then the supplied default. The
// returned gvar.Var carries GoFrame's type conversions.
func (s *Store) get(key string, def interface{}) *gvar.Var {
	if v, ok := os.LookupEnv(strings.ToUpper(key)); ok {
		return gvar.New(v)
	}
	v, err := g.Cfg().Get(bg(), key, def)
	if err != nil || v == nil {
		return gvar.New(def)
	}
	return v
}

// Path returns the resolved path of the active GoFrame config file.
func (s *Store) Path() string {
	if a, ok := adapter(); ok {
		if p, err := a.GetFilePath("config"); err == nil {
			return p
		}
	}
	return ""
}

// Get returns the raw value for key, or nil when absent.
func (s *Store) Get(key string) interface{} {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.get(key, nil).Val()
}

// GetString returns a string value, returning "" when absent.
func (s *Store) GetString(key string) string {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.get(key, "").String()
}

// GetBool returns a boolean value.
func (s *Store) GetBool(key string) bool {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.get(key, false).Bool()
}

// GetInt returns an integer value with an explicit default.
func (s *Store) GetInt(key string, def int) int {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.get(key, def).Int()
}

// GetFloat returns a float value with an explicit default.
func (s *Store) GetFloat(key string, def float64) float64 {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.get(key, def).Float64()
}

// GetStringMap returns a nested object value as a map (nil when absent).
func (s *Store) GetStringMap(key string) map[string]interface{} {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.get(key, nil).Map()
}

// Set updates a single key in the in-memory adapter. Call Save to persist it to
// the config file.
func (s *Store) Set(key string, value interface{}) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if a, ok := adapter(); ok {
		_ = a.Set(key, value)
	}
}

// Snapshot returns all configuration as a plain map.
func (s *Store) Snapshot() map[string]interface{} {
	s.mu.RLock()
	defer s.mu.RUnlock()
	data, err := g.Cfg().Data(bg())
	if err != nil || data == nil {
		return map[string]interface{}{}
	}
	return data
}

// Save persists the current configuration back to the GoFrame config file and
// drops the in-memory cache so the next read sees the written values.
func (s *Store) Save() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	data, err := g.Cfg().Data(bg())
	if err != nil {
		return err
	}
	raw, err := yaml.Marshal(data)
	if err != nil {
		return err
	}
	a, ok := adapter()
	if !ok {
		return nil
	}
	path, err := a.GetFilePath("config")
	if err != nil || path == "" {
		return err
	}
	if err := gfile.PutBytes(path, raw); err != nil {
		return err
	}
	a.Clear()
	return nil
}

// Reload discards the in-memory cache, forcing a re-read from file next access.
func (s *Store) Reload() {
	s.mu.Lock()
	defer s.mu.Unlock()
	if a, ok := adapter(); ok {
		a.Clear()
	}
}

// MaskKey masks the middle of a secret, keeping the first/last 4 characters.
func MaskKey(value string) string {
	if value == "" || len(value) <= 8 {
		return value
	}
	return value[:4] + strings.Repeat("*", len(value)-8) + value[len(value)-4:]
}
