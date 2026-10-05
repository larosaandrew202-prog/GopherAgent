// Package store owns the SQLite database used by GopherAgent.
//
// It configures GoFrame's sqlite driver programmatically (no config file
// required) and creates the schema on first use.
package store

import (
	"context"
	"os"
	"path/filepath"
	"sync"

	_ "github.com/gogf/gf/contrib/drivers/sqlite/v2"
	"github.com/gogf/gf/v2/database/gdb"
	"github.com/gogf/gf/v2/frame/g"
)

// DBFileName is the SQLite file created under the data root.
const DBFileName = "gopher_agent.db"

var (
	initOnce sync.Once
	initErr  error
	dbPath   string
)

// DataRoot returns the directory holding writable application data.
// GOPHER_DATA_DIR / COW_DATA_DIR take precedence; otherwise the process
// working directory is used.
func DataRoot() string {
	if dir := os.Getenv("GOPHER_DATA_DIR"); dir != "" {
		return dir
	}
	if dir := os.Getenv("COW_DATA_DIR"); dir != "" {
		return dir
	}
	if wd, err := os.Getwd(); err == nil {
		return wd
	}
	return "."
}

// DataPath joins name onto the data root, creating the directory.
func DataPath(name string) string {
	root := DataRoot()
	_ = os.MkdirAll(root, 0o755)
	return filepath.Join(root, name)
}

// DBPath returns the absolute path of the SQLite database file.
func DBPath() string {
	return DataPath(DBFileName)
}

// Init configures the database connection and applies migrations once.
func Init() error {
	initOnce.Do(func() {
		dbPath = DBPath()
		gdb.SetConfig(gdb.Config{
			"default": gdb.ConfigGroup{
				gdb.ConfigNode{
					Type: "sqlite",
					Link: dbPath,
				},
			},
		})
		initErr = migrate()
	})
	return initErr
}

// DB returns the default GoFrame database handle.
func DB() gdb.DB {
	if err := Init(); err != nil {
		panic(err)
	}
	return g.DB()
}

// Path returns the resolved database file path.
func Path() string { return dbPath }

func migrate() error {
	ctx := context.Background()
	db := g.DB()

	statements := []string{
		`CREATE TABLE IF NOT EXISTS config (
			k          TEXT PRIMARY KEY,
			v          TEXT NOT NULL,
			updated_at INTEGER NOT NULL DEFAULT 0
		)`,
		`CREATE TABLE IF NOT EXISTS sessions (
			id             TEXT PRIMARY KEY,
			title          TEXT NOT NULL DEFAULT '',
			created_at     INTEGER NOT NULL DEFAULT 0,
			updated_at     INTEGER NOT NULL DEFAULT 0,
			pinned         INTEGER NOT NULL DEFAULT 0,
			project_dir    TEXT NOT NULL DEFAULT '',
			permission     TEXT NOT NULL DEFAULT '',
			model_provider TEXT NOT NULL DEFAULT '',
			model_name     TEXT NOT NULL DEFAULT ''
		)`,
		`CREATE TABLE IF NOT EXISTS messages (
			seq        INTEGER PRIMARY KEY AUTOINCREMENT,
			session_id TEXT NOT NULL,
			role       TEXT NOT NULL,
			content    TEXT NOT NULL DEFAULT '',
			thinking   TEXT NOT NULL DEFAULT '',
			created_at INTEGER NOT NULL DEFAULT 0
		)`,
		`CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id, seq)`,
		`CREATE INDEX IF NOT EXISTS idx_sessions_updated ON sessions(updated_at DESC)`,
		`CREATE TABLE IF NOT EXISTS scheduled_tasks (
			id             TEXT PRIMARY KEY,
			name           TEXT NOT NULL DEFAULT '',
			enabled        INTEGER NOT NULL DEFAULT 1,
			schedule_type  TEXT NOT NULL DEFAULT '',
			schedule_value TEXT NOT NULL DEFAULT '',
			action_type    TEXT NOT NULL DEFAULT '',
			content        TEXT NOT NULL DEFAULT '',
			session_id     TEXT NOT NULL DEFAULT '',
			silent         INTEGER NOT NULL DEFAULT 0,
			next_run_at    INTEGER NOT NULL DEFAULT 0,
			last_run_at    INTEGER NOT NULL DEFAULT 0,
			last_result    TEXT NOT NULL DEFAULT '',
			created_at     INTEGER NOT NULL DEFAULT 0,
			updated_at     INTEGER NOT NULL DEFAULT 0
		)`,
		`CREATE INDEX IF NOT EXISTS idx_tasks_next ON scheduled_tasks(next_run_at)`,
		`CREATE TABLE IF NOT EXISTS memory_chunks (
			id         TEXT PRIMARY KEY,
			user_id    TEXT NOT NULL DEFAULT '',
			scope      TEXT NOT NULL DEFAULT 'shared',
			source     TEXT NOT NULL DEFAULT 'memory',
			path       TEXT NOT NULL,
			start_line INTEGER NOT NULL DEFAULT 0,
			end_line   INTEGER NOT NULL DEFAULT 0,
			text       TEXT NOT NULL,
			embedding  BLOB,
			hash       TEXT NOT NULL DEFAULT '',
			updated_at INTEGER NOT NULL DEFAULT 0
		)`,
		`CREATE INDEX IF NOT EXISTS idx_memory_chunks_path ON memory_chunks(path)`,
		`CREATE TABLE IF NOT EXISTS memory_files (
			path       TEXT PRIMARY KEY,
			source     TEXT NOT NULL DEFAULT 'memory',
			hash       TEXT NOT NULL DEFAULT '',
			mtime      INTEGER NOT NULL DEFAULT 0,
			size       INTEGER NOT NULL DEFAULT 0,
			updated_at INTEGER NOT NULL DEFAULT 0
		)`,
	}
	for _, stmt := range statements {
		if _, err := db.Exec(ctx, stmt); err != nil {
			return err
		}
	}
	return nil
}
