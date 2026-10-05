// Package memory implements file-based long-term memory with hybrid
// (vector + keyword) retrieval over an SQLite index.
//
// Memory lives as Markdown files in the agent workspace:
//
//	MEMORY.md            evergreen facts (injected into the system prompt)
//	memory/YYYY-MM-DD.md daily notes (subject to temporal decay)
//	knowledge/**.md      optional knowledge base
package memory

import (
	"context"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"GopherAgent/internal/consts"
	configlogic "GopherAgent/internal/logic/config"
	"GopherAgent/internal/logic/embedding"
	"GopherAgent/internal/logic/paths"
)

const (
	globalMemoryFile = "MEMORY.md"
	memorySubdir     = "memory"
	syncInterval     = 30 * time.Second
)

var (
	mu       sync.Mutex
	dirty    = true
	lastSync time.Time
)

// FileInfo describes a memory file for the console.
type FileInfo struct {
	Filename  string `json:"filename"`
	Type      string `json:"type"`
	Size      int64  `json:"size"`
	UpdatedAt string `json:"updated_at"`
}

// SearchOptions tunes a memory search.
type SearchOptions struct {
	UserID     string
	MaxResults int
	MinScore   float64
}

// MarkDirty flags the index as needing a resync.
func MarkDirty() {
	mu.Lock()
	dirty = true
	mu.Unlock()
}

// Workspace returns the agent workspace directory.
func Workspace() string { return paths.Workspace() }

func memoryDir() string { return filepath.Join(Workspace(), memorySubdir) }

// EnsureFiles creates the memory directory and default files when missing.
func EnsureFiles() {
	ws := Workspace()
	_ = os.MkdirAll(memoryDir(), 0o755)

	global := filepath.Join(ws, globalMemoryFile)
	if !fileExists(global) {
		content := "# Long-term Memory\n\n" +
			"Concise, durable facts about the user, their preferences and ongoing work.\n" +
			"Keep this file short; the agent reads it on every conversation.\n"
		_ = os.WriteFile(global, []byte(content), 0o644)
	}

	today := time.Now().Format("2006-01-02")
	daily := filepath.Join(memoryDir(), today+".md")
	if !fileExists(daily) {
		_ = os.WriteFile(daily, []byte("# "+today+"\n"), 0o644)
	}
}

type memoryFile struct {
	abs    string
	rel    string
	source string
}

func collectFiles() []memoryFile {
	ws := Workspace()
	var out []memoryFile

	global := filepath.Join(ws, globalMemoryFile)
	if fileExists(global) {
		out = append(out, memoryFile{global, globalMemoryFile, consts.MemorySourceMemory})
	}
	out = append(out, walkMarkdown(ws, memoryDir(), consts.MemorySourceMemory)...)
	if configlogic.C().GetBool(consts.CfgKnowledge) {
		out = append(out, walkMarkdown(ws, filepath.Join(ws, "knowledge"), consts.MemorySourceMemory)...)
	}
	return out
}

func walkMarkdown(root, dir, source string) []memoryFile {
	var out []memoryFile
	_ = filepath.WalkDir(dir, func(path string, d fs.DirEntry, err error) error {
		if err != nil || d == nil || d.IsDir() {
			return nil
		}
		if !strings.HasSuffix(strings.ToLower(d.Name()), ".md") {
			return nil
		}
		rel, relErr := filepath.Rel(root, path)
		if relErr != nil {
			return nil
		}
		out = append(out, memoryFile{path, filepath.ToSlash(rel), source})
		return nil
	})
	return out
}

// Sync indexes changed memory files. On embedding failure the existing index is
// left untouched so the next sync retries.
func Sync(ctx context.Context) (bool, error) {
	mu.Lock()
	defer mu.Unlock()
	return syncLocked(ctx)
}

func syncLocked(ctx context.Context) (bool, error) {
	provider, _ := embedding.FromConfig()

	// If a provider is (now) available but some chunks still lack vectors —
	// e.g. they were indexed before embedding was configured — force a rebuild.
	force := false
	if provider != nil {
		_, chunkCount, embeddedCount, _ := chunkStats(ctx)
		if chunkCount > embeddedCount {
			force = true
		}
	}

	type pending struct {
		file   memoryFile
		hash   string
		mtime  int64
		size   int64
		chunks []chunk
	}

	var pendings []pending
	for _, f := range collectFiles() {
		data, err := os.ReadFile(f.abs)
		if err != nil {
			continue
		}
		hash := sha256Hex(string(data))
		if !force {
			if old, ok := loadFileHash(ctx, f.rel); ok && old == hash {
				continue
			}
		}
		info, _ := os.Stat(f.abs)
		var mtime, size int64
		if info != nil {
			mtime, size = info.ModTime().Unix(), info.Size()
		}
		pendings = append(pendings, pending{
			file:   f,
			hash:   hash,
			mtime:  mtime,
			size:   size,
			chunks: chunkText(string(data), chunkChars(), overlapChars()),
		})
	}

	if len(pendings) == 0 {
		dirty = false
		lastSync = time.Now()
		return false, nil
	}

	var allTexts []string
	for _, p := range pendings {
		for _, c := range p.chunks {
			allTexts = append(allTexts, c.Text)
		}
	}

	var vectors [][]float32
	if provider != nil && len(allTexts) > 0 {
		v, err := provider.Embed(ctx, allTexts)
		if err != nil {
			return false, err
		}
		vectors = v
	} else {
		vectors = make([][]float32, len(allTexts))
	}

	cursor := 0
	for _, p := range pendings {
		_ = deleteChunksByPath(ctx, p.file.rel)
		stored := make([]storedChunk, 0, len(p.chunks))
		for _, c := range p.chunks {
			var vec []float32
			if cursor < len(vectors) {
				vec = vectors[cursor]
			}
			cursor++
			id := sha256Hex(fmt.Sprintf("%s:%d:%d", p.file.rel, c.StartLine, c.EndLine))
			stored = append(stored, storedChunk{
				ID:        id[:32],
				Scope:     consts.MemoryScopeShared,
				Source:    p.file.source,
				Path:      p.file.rel,
				StartLine: c.StartLine,
				EndLine:   c.EndLine,
				Text:      c.Text,
				Embedding: vec,
				Hash:      sha256Hex(c.Text),
			})
		}
		if err := saveChunks(ctx, stored); err != nil {
			return false, err
		}
		_ = upsertFileMeta(ctx, p.file.rel, p.file.source, p.hash, p.mtime, p.size)
	}

	dirty = false
	lastSync = time.Now()
	return true, nil
}

func maybeSync(ctx context.Context) {
	mu.Lock()
	need := dirty || time.Since(lastSync) > syncInterval
	mu.Unlock()
	if need {
		_, _ = Sync(ctx)
	}
}

// Search runs hybrid (vector + keyword) retrieval over the memory index.
func Search(ctx context.Context, query string, opts SearchOptions) ([]Result, error) {
	query = strings.TrimSpace(query)
	if query == "" {
		return nil, fmt.Errorf("query is required")
	}
	EnsureFiles()
	maybeSync(ctx)

	s := configlogic.C()
	maxResults := opts.MaxResults
	if maxResults <= 0 {
		maxResults = s.GetInt(consts.CfgMemoryMaxResults, 10)
	}
	if maxResults > 50 {
		maxResults = 50
	}
	minScore := opts.MinScore
	if minScore <= 0 {
		minScore = s.GetFloat(consts.CfgMemoryMinScore, 0.1)
	}
	vectorWeight := s.GetFloat(consts.CfgMemoryVectorWeight, 0.7)
	keywordWeight := s.GetFloat(consts.CfgMemoryKeywordWeight, 0.3)
	halfLife := s.GetFloat(consts.CfgMemoryHalfLifeDays, 30)

	scopes := []string{consts.MemoryScopeShared}
	if opts.UserID != "" {
		scopes = append(scopes, consts.MemoryScopeUser)
	}

	var vectorHits []scoredChunk
	if provider, err := embedding.FromConfig(); err == nil && provider != nil {
		if qv, err := provider.Embed(ctx, []string{query}); err == nil && len(qv) == 1 {
			if chunks, err := chunksForVector(ctx, scopes, opts.UserID); err == nil {
				vectorHits = vectorSearch(chunks, qv[0], maxResults*2)
			}
		}
	}

	keywordHits, _ := keywordChunks(ctx, tokenize(query), scopes, opts.UserID, maxResults*2)

	return mergeHybrid(vectorHits, keywordHits, vectorWeight, keywordWeight, minScore, halfLife, maxResults), nil
}

// ListFiles returns MEMORY.md and daily files, newest first.
func ListFiles() []FileInfo {
	EnsureFiles()
	ws := Workspace()
	var out []FileInfo

	if info, err := os.Stat(filepath.Join(ws, globalMemoryFile)); err == nil {
		out = append(out, FileInfo{globalMemoryFile, "global", info.Size(), info.ModTime().Format("2006-01-02 15:04:05")})
	}

	var dailies []FileInfo
	entries, _ := os.ReadDir(memoryDir())
	for _, e := range entries {
		if e.IsDir() || !strings.HasSuffix(strings.ToLower(e.Name()), ".md") {
			continue
		}
		info, err := e.Info()
		if err != nil {
			continue
		}
		dailies = append(dailies, FileInfo{e.Name(), "daily", info.Size(), info.ModTime().Format("2006-01-02 15:04:05")})
	}
	sort.Slice(dailies, func(i, j int) bool { return dailies[i].Filename > dailies[j].Filename })
	return append(out, dailies...)
}

// ReadFile returns the content of a memory file.
func ReadFile(name string) (string, error) {
	path, err := resolveMemoryPath(name)
	if err != nil {
		return "", err
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return "", err
	}
	return string(data), nil
}

// GetLines returns a line range from a memory file.
func GetLines(name string, startLine, numLines int) (string, error) {
	content, err := ReadFile(name)
	if err != nil {
		return "", err
	}
	lines := strings.Split(content, "\n")
	if startLine < 1 {
		startLine = 1
	}
	if startLine > len(lines) {
		return "", fmt.Errorf("start_line %d is past the end of %s (%d lines)", startLine, name, len(lines))
	}
	end := len(lines)
	if numLines > 0 && startLine-1+numLines < end {
		end = startLine - 1 + numLines
	}
	var b strings.Builder
	for i := startLine - 1; i < end; i++ {
		fmt.Fprintf(&b, "%6d\t%s\n", i+1, lines[i])
	}
	return b.String(), nil
}

// AppendDaily appends a block to today's daily memory file.
func AppendDaily(content string) error {
	EnsureFiles()
	content = strings.TrimSpace(content)
	if content == "" {
		return nil
	}
	today := time.Now().Format("2006-01-02")
	path := filepath.Join(memoryDir(), today+".md")
	f, err := os.OpenFile(path, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o644)
	if err != nil {
		return err
	}
	defer f.Close()
	if _, err := fmt.Fprintf(f, "\n## %s\n\n%s\n", time.Now().Format("15:04"), content); err != nil {
		return err
	}
	MarkDirty()
	return nil
}

// Stats reports index counts.
func Stats(ctx context.Context) map[string]int {
	files, chunks, embedded, _ := chunkStats(ctx)
	return map[string]int{"files": files, "chunks": chunks, "embedded": embedded}
}

func resolveMemoryPath(name string) (string, error) {
	name = strings.TrimSpace(name)
	if name == "" || name == globalMemoryFile {
		return filepath.Join(Workspace(), globalMemoryFile), nil
	}
	base := memoryDir()
	clean := filepath.Clean(filepath.Join(base, filepath.Base(name)))
	rel, err := filepath.Rel(base, clean)
	if err != nil || strings.HasPrefix(rel, "..") {
		return "", fmt.Errorf("invalid memory file: %s", name)
	}
	return clean, nil
}

func fileExists(path string) bool {
	info, err := os.Stat(path)
	return err == nil && !info.IsDir()
}

func chunkChars() int {
	tokens := configlogic.C().GetInt(consts.CfgMemoryChunkTokens, 500)
	if tokens <= 0 {
		tokens = 500
	}
	return tokens * 4
}

func overlapChars() int {
	tokens := configlogic.C().GetInt(consts.CfgMemoryChunkOverlap, 50)
	if tokens < 0 {
		tokens = 0
	}
	return tokens * 4
}
