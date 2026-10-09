package chat

import (
	"context"
	"sync"
	"time"

	"GopherAgent/internal/logic/redisx"
)

// Memory flush watermarks record how many messages a session has already been
// summarised up to, so summarizeSession runs at most once per threshold. They
// are backed by a per-session Redis key with a TTL when Redis is configured
// (so idle sessions release their key), and by an in-process map otherwise
// (single-node behaviour is unchanged).
const flushWatermarkTTL = 30 * 24 * time.Hour

var (
	flushMu     sync.Mutex
	flushedUpTo = map[string]int64{}
)

func flushWatermark(ctx context.Context, sessionID string) int64 {
	if rdb := redisx.Client(); rdb != nil {
		v, err := rdb.Get(ctx, redisx.Key("mem", "flushed", sessionID)).Int64()
		if err != nil {
			return 0
		}
		return v
	}
	flushMu.Lock()
	defer flushMu.Unlock()
	return flushedUpTo[sessionID]
}

func setFlushWatermark(ctx context.Context, sessionID string, v int64) {
	if rdb := redisx.Client(); rdb != nil {
		_ = rdb.Set(ctx, redisx.Key("mem", "flushed", sessionID), v, flushWatermarkTTL).Err()
		return
	}
	flushMu.Lock()
	flushedUpTo[sessionID] = v
	flushMu.Unlock()
}
