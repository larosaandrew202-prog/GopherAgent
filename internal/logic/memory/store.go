package memory

import (
	"context"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"math"
	"strings"
	"time"

	"github.com/gogf/gf/v2/database/gdb"
	"github.com/gogf/gf/v2/frame/g"

	"GopherAgent/internal/consts"
	"GopherAgent/internal/store"
)

// storedChunk is a persisted memory chunk.
type storedChunk struct {
	ID        string
	UserID    string
	Scope     string
	Source    string
	Path      string
	StartLine int
	EndLine   int
	Text      string
	Embedding []float32
	Hash      string
}

// scoredChunk is a chunk with a relevance score.
type scoredChunk struct {
	storedChunk
	Score float64
}

func sha256Hex(s string) string {
	sum := sha256.Sum256([]byte(s))
	return hex.EncodeToString(sum[:])
}

func encodeEmbedding(vec []float32) []byte {
	if len(vec) == 0 {
		return nil
	}
	out := make([]byte, 4*len(vec))
	for i, v := range vec {
		binary.LittleEndian.PutUint32(out[i*4:], math.Float32bits(v))
	}
	return out
}

func decodeEmbedding(raw []byte) []float32 {
	if len(raw) < 4 {
		return nil
	}
	n := len(raw) / 4
	out := make([]float32, n)
	for i := 0; i < n; i++ {
		out[i] = math.Float32frombits(binary.LittleEndian.Uint32(raw[i*4:]))
	}
	return out
}

func loadFileHash(ctx context.Context, path string) (string, bool) {
	row, err := store.DB().Model(consts.TableMemoryFiles).Ctx(ctx).Where("path", path).One()
	if err != nil || row.IsEmpty() {
		return "", false
	}
	return row["hash"].String(), true
}

func deleteChunksByPath(ctx context.Context, path string) error {
	_, err := store.DB().Model(consts.TableMemoryChunks).Ctx(ctx).Where("path", path).Delete()
	return err
}

func saveChunks(ctx context.Context, chunks []storedChunk) error {
	if len(chunks) == 0 {
		return nil
	}
	rows := make([]g.Map, 0, len(chunks))
	now := time.Now().Unix()
	for _, c := range chunks {
		var emb interface{}
		if len(c.Embedding) > 0 {
			emb = encodeEmbedding(c.Embedding)
		}
		rows = append(rows, g.Map{
			"id":         c.ID,
			"user_id":    c.UserID,
			"scope":      c.Scope,
			"source":     c.Source,
			"path":       c.Path,
			"start_line": c.StartLine,
			"end_line":   c.EndLine,
			"text":       c.Text,
			"embedding":  emb,
			"hash":       c.Hash,
			"updated_at": now,
		})
	}
	_, err := store.DB().Model(consts.TableMemoryChunks).Ctx(ctx).Data(rows).Insert()
	return err
}

func upsertFileMeta(ctx context.Context, path, source, hash string, mtime, size int64) error {
	_, err := store.DB().Model(consts.TableMemoryFiles).Ctx(ctx).Data(g.Map{
		"path":       path,
		"source":     source,
		"hash":       hash,
		"mtime":      mtime,
		"size":       size,
		"updated_at": time.Now().Unix(),
	}).OnConflict("path").Save()
	return err
}

// chunksForVector loads chunks that carry an embedding and match the scope.
func chunksForVector(ctx context.Context, scopes []string, userID string) ([]storedChunk, error) {
	model := store.DB().Model(consts.TableMemoryChunks).Ctx(ctx).
		Where("embedding IS NOT NULL").
		WhereIn("scope", toInterfaces(scopes))
	if userID != "" {
		model = model.Where("(scope = ? OR user_id = ?)", consts.MemoryScopeShared, userID)
	}
	rows, err := model.All()
	if err != nil {
		return nil, err
	}
	return rowsToChunks(rows), nil
}

// keywordChunks performs a LIKE-based keyword search with per-chunk scoring.
func keywordChunks(ctx context.Context, words []string, scopes []string, userID string, limit int) ([]scoredChunk, error) {
	if len(words) == 0 {
		return nil, nil
	}
	conds := make([]string, 0, len(words))
	args := make([]interface{}, 0, len(words))
	for _, w := range words {
		conds = append(conds, "LOWER(text) LIKE ?")
		args = append(args, "%"+strings.ToLower(w)+"%")
	}
	model := store.DB().Model(consts.TableMemoryChunks).Ctx(ctx).
		Where("("+strings.Join(conds, " OR ")+")", args...).
		WhereIn("scope", toInterfaces(scopes))
	if userID != "" {
		model = model.Where("(scope = ? OR user_id = ?)", consts.MemoryScopeShared, userID)
	}
	if limit > 0 {
		model = model.Limit(limit)
	}
	rows, err := model.All()
	if err != nil {
		return nil, err
	}

	out := make([]scoredChunk, 0, len(rows))
	for _, row := range rows {
		c := rowToChunk(row)
		lower := strings.ToLower(c.Text)
		matched := 0
		for _, w := range words {
			if strings.Contains(lower, strings.ToLower(w)) {
				matched++
			}
		}
		if matched == 0 {
			continue
		}
		score := math.Min(0.85, 0.3+0.15*float64(matched))
		out = append(out, scoredChunk{storedChunk: c, Score: score})
	}
	return out, nil
}

func chunkStats(ctx context.Context) (files, chunks, embedded int, err error) {
	files, err = store.DB().Model(consts.TableMemoryFiles).Ctx(ctx).Count()
	if err != nil {
		return
	}
	chunks, err = store.DB().Model(consts.TableMemoryChunks).Ctx(ctx).Count()
	if err != nil {
		return
	}
	embedded, err = store.DB().Model(consts.TableMemoryChunks).Ctx(ctx).Where("embedding IS NOT NULL").Count()
	return
}

func rowsToChunks(rows gdb.Result) []storedChunk {
	out := make([]storedChunk, 0, len(rows))
	for _, row := range rows {
		out = append(out, rowToChunk(row))
	}
	return out
}

func rowToChunk(row gdb.Record) storedChunk {
	return storedChunk{
		ID:        row["id"].String(),
		UserID:    row["user_id"].String(),
		Scope:     row["scope"].String(),
		Source:    row["source"].String(),
		Path:      row["path"].String(),
		StartLine: row["start_line"].Int(),
		EndLine:   row["end_line"].Int(),
		Text:      row["text"].String(),
		Embedding: decodeEmbedding(row["embedding"].Bytes()),
		Hash:      row["hash"].String(),
	}
}

func toInterfaces(values []string) []interface{} {
	out := make([]interface{}, len(values))
	for i, v := range values {
		out[i] = v
	}
	return out
}
