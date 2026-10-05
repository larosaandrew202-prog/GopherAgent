// Package config implements the runtime configuration store for GopherAgent.
//
// Values are persisted in the SQLite `config` table (key/value) and defaulted
// from a bundled template, so the application runs with no config file.
package config

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/gogf/gf/v2/frame/g"

	"GopherAgent/internal/consts"
	"GopherAgent/internal/store"

	_ "embed"
)

//go:embed template/default.json
var defaultTemplate []byte

// Store is a concurrency-safe, SQLite-backed configuration store.
type Store struct {
	mu   sync.RWMutex
	data map[string]interface{}
}

var (
	storeInst *Store
	storeOnce sync.Once
)

// Init loads the configuration once. Safe to call multiple times.
func Init() error {
	var err error
	storeOnce.Do(func() {
		if ierr := store.Init(); ierr != nil {
			err = ierr
			return
		}
		storeInst, err = load()
	})
	if err != nil {
		return err
	}
	if storeInst == nil {
		return fmt.Errorf("config store initialisation failed")
	}
	return nil
}

// C returns the process-wide configuration store, initialising it on demand.
func C() *Store {
	if storeInst == nil {
		_ = Init()
	}
	if storeInst == nil {
		storeInst = &Store{data: defaultValues()}
	}
	return storeInst
}

// Path returns the SQLite database path holding the configuration.
func (s *Store) Path() string { return store.Path() }

func defaultValues() map[string]interface{} {
	defaults := map[string]interface{}{}
	if err := json.Unmarshal(defaultTemplate, &defaults); err != nil {
		defaults = map[string]interface{}{}
	}
	return defaults
}

func load() (*Store, error) {
	data := defaultValues()

	ctx := context.Background()
	rows, err := store.DB().GetAll(ctx, "SELECT k, v FROM "+consts.TableConfig)
	if err != nil {
		return nil, err
	}
	for _, row := range rows {
		key := row["k"].String()
		if key == "" {
			continue
		}
		var value interface{}
		if err := json.Unmarshal([]byte(row["v"].String()), &value); err != nil {
			continue
		}
		data[key] = value
	}

	s := &Store{data: data}
	// Seed defaults on first run so the table is the source of truth.
	if len(rows) == 0 {
		if err := s.Save(); err != nil {
			return nil, err
		}
	}
	return s, nil
}

// Get returns the raw value for key, or nil when absent.
func (s *Store) Get(key string) interface{} {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.data[key]
}

// GetString returns a string value, returning "" when absent.
func (s *Store) GetString(key string) string {
	switch t := s.Get(key).(type) {
	case string:
		return t
	case nil:
		return ""
	default:
		return fmt.Sprintf("%v", t)
	}
}

// GetBool returns a boolean value.
func (s *Store) GetBool(key string) bool {
	switch t := s.Get(key).(type) {
	case bool:
		return t
	case string:
		return strings.EqualFold(t, "true")
	case float64:
		return t != 0
	default:
		return false
	}
}

// GetInt returns an integer value with an explicit default.
func (s *Store) GetInt(key string, def int) int {
	switch t := s.Get(key).(type) {
	case int:
		return t
	case int64:
		return int(t)
	case float64:
		return int(t)
	case json.Number:
		if n, err := t.Int64(); err == nil {
			return int(n)
		}
	case string:
		var n int
		if _, err := fmt.Sscanf(t, "%d", &n); err == nil {
			return n
		}
	}
	return def
}

// GetFloat returns a float value with an explicit default.
func (s *Store) GetFloat(key string, def float64) float64 {
	switch t := s.Get(key).(type) {
	case float64:
		return t
	case int:
		return float64(t)
	case int64:
		return float64(t)
	case json.Number:
		if f, err := t.Float64(); err == nil {
			return f
		}
	case string:
		var f float64
		if _, err := fmt.Sscanf(t, "%g", &f); err == nil {
			return f
		}
	}
	return def
}

// GetStringMap returns a shallow copy of a nested object value.
func (s *Store) GetStringMap(key string) map[string]interface{} {
	v, ok := s.Get(key).(map[string]interface{})
	if !ok {
		return nil
	}
	out := make(map[string]interface{}, len(v))
	for k, val := range v {
		out[k] = val
	}
	return out
}

// Set updates a single key in memory. Call Save to persist.
func (s *Store) Set(key string, value interface{}) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.data[key] = value
}

// Snapshot returns a deep copy of the current configuration.
func (s *Store) Snapshot() map[string]interface{} {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return deepCopy(s.data).(map[string]interface{})
}

// Save upserts every in-memory key into the SQLite config table.
func (s *Store) Save() error {
	snapshot := s.Snapshot()
	now := time.Now().Unix()
	rows := make([]g.Map, 0, len(snapshot))
	for k, v := range snapshot {
		encoded, err := json.Marshal(v)
		if err != nil {
			continue
		}
		rows = append(rows, g.Map{"k": k, "v": string(encoded), "updated_at": now})
	}
	if len(rows) == 0 {
		return nil
	}
	_, err := store.DB().Model(consts.TableConfig).Ctx(context.Background()).Data(rows).OnConflict("k").Save()
	return err
}

// Reload re-reads configuration from the database, discarding in-memory changes.
func (s *Store) Reload() {
	fresh, err := load()
	if err != nil {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.data = fresh.data
}

// MaskKey masks the middle of a secret, keeping the first/last 4 characters.
func MaskKey(value string) string {
	if value == "" || len(value) <= 8 {
		return value
	}
	return value[:4] + strings.Repeat("*", len(value)-8) + value[len(value)-4:]
}

func deepCopy(v interface{}) interface{} {
	switch t := v.(type) {
	case map[string]interface{}:
		out := make(map[string]interface{}, len(t))
		for k, val := range t {
			out[k] = deepCopy(val)
		}
		return out
	case []interface{}:
		out := make([]interface{}, len(t))
		for i, val := range t {
			out[i] = deepCopy(val)
		}
		return out
	default:
		return v
	}
}
