package memory

import (
	"math"
	"regexp"
	"sort"
	"strings"
	"time"
)

// Result is one hybrid search hit.
type Result struct {
	Path      string
	StartLine int
	EndLine   int
	Score     float64
	Snippet   string
}

var (
	cjkTokenRe   = regexp.MustCompile(`[\p{Han}\p{Hiragana}\p{Katakana}\p{Hangul}]+`)
	asciiTokenRe = regexp.MustCompile(`[A-Za-z0-9_]+`)
	dateFileRe   = regexp.MustCompile(`(\d{4})-(\d{2})-(\d{2})\.md$`)
)

// tokenize splits a query into CJK runs and ASCII words (3+ chars).
func tokenize(query string) []string {
	words := cjkTokenRe.FindAllString(query, -1)
	for _, w := range asciiTokenRe.FindAllString(query, -1) {
		if len(w) >= 3 {
			words = append(words, w)
		}
	}
	return words
}

func cosine(a, b []float32) float64 {
	if len(a) != len(b) || len(a) == 0 {
		return 0
	}
	var dot, na, nb float64
	for i := range a {
		dot += float64(a[i]) * float64(b[i])
		na += float64(a[i]) * float64(a[i])
		nb += float64(b[i]) * float64(b[i])
	}
	if na == 0 || nb == 0 {
		return 0
	}
	return dot / (math.Sqrt(na) * math.Sqrt(nb))
}

func vectorSearch(chunks []storedChunk, query []float32, limit int) []scoredChunk {
	out := make([]scoredChunk, 0, len(chunks))
	for _, c := range chunks {
		if len(c.Embedding) != len(query) {
			continue
		}
		score := cosine(c.Embedding, query)
		if score > 0 {
			out = append(out, scoredChunk{storedChunk: c, Score: score})
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Score > out[j].Score })
	if limit > 0 && len(out) > limit {
		out = out[:limit]
	}
	return out
}

// mergeHybrid combines vector and keyword hits by (path,start,end), applies the
// configured weights and temporal decay, then filters and ranks.
func mergeHybrid(vectorHits, keywordHits []scoredChunk, vectorWeight, keywordWeight, minScore, halfLifeDays float64, limit int) []Result {
	type entry struct {
		chunk        storedChunk
		vectorScore  float64
		keywordScore float64
	}
	merged := map[string]*entry{}
	key := func(c storedChunk) string {
		return c.Path + ":" + itoa(c.StartLine) + ":" + itoa(c.EndLine)
	}

	for _, h := range vectorHits {
		k := key(h.storedChunk)
		e := merged[k]
		if e == nil {
			e = &entry{chunk: h.storedChunk}
			merged[k] = e
		}
		e.vectorScore = h.Score
	}
	for _, h := range keywordHits {
		k := key(h.storedChunk)
		e := merged[k]
		if e == nil {
			e = &entry{chunk: h.storedChunk}
			merged[k] = e
		}
		e.keywordScore = h.Score
	}

	results := make([]Result, 0, len(merged))
	for _, e := range merged {
		score := vectorWeight*e.vectorScore + keywordWeight*e.keywordScore
		score *= temporalDecay(e.chunk.Path, halfLifeDays)
		if score < minScore {
			continue
		}
		results = append(results, Result{
			Path:      e.chunk.Path,
			StartLine: e.chunk.StartLine,
			EndLine:   e.chunk.EndLine,
			Score:     score,
			Snippet:   snippet(e.chunk.Text, 500),
		})
	}
	sort.Slice(results, func(i, j int) bool { return results[i].Score > results[j].Score })
	if limit > 0 && len(results) > limit {
		results = results[:limit]
	}
	return results
}

// temporalDecay exponentially decays dated daily files; MEMORY.md is evergreen.
func temporalDecay(path string, halfLifeDays float64) float64 {
	if halfLifeDays <= 0 {
		return 1.0
	}
	match := dateFileRe.FindStringSubmatch(path)
	if match == nil {
		return 1.0
	}
	fileDate, err := time.ParseInLocation("2006-01-02", match[1]+"-"+match[2]+"-"+match[3], time.Local)
	if err != nil {
		return 1.0
	}
	ageDays := time.Since(fileDate).Hours() / 24
	if ageDays <= 0 {
		return 1.0
	}
	return math.Exp(-math.Ln2 / halfLifeDays * ageDays)
}

func snippet(text string, max int) string {
	text = strings.TrimSpace(text)
	if len(text) <= max {
		return text
	}
	return text[:max] + "..."
}

func itoa(v int) string {
	if v == 0 {
		return "0"
	}
	neg := v < 0
	if neg {
		v = -v
	}
	var buf [20]byte
	i := len(buf)
	for v > 0 {
		i--
		buf[i] = byte('0' + v%10)
		v /= 10
	}
	if neg {
		i--
		buf[i] = '-'
	}
	return string(buf[i:])
}
