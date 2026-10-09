package chat

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/redis/go-redis/v9"

	"GopherAgent/internal/consts"
	"GopherAgent/internal/logic/redisx"
)

// TestLiveRedisBus runs the Redis bus against a real server. It is skipped
// unless GOPHER_REDIS_LIVE is set, e.g.
//
//	GOPHER_REDIS_LIVE=127.0.0.1:6379 GOPHER_REDIS_LIVE_PW=secret go test ./internal/logic/chat -run TestLiveRedisBus -v
//
// It uses an isolated key prefix and removes its keys afterwards.
func TestLiveRedisBus(t *testing.T) {
	addr := os.Getenv("GOPHER_REDIS_LIVE")
	if addr == "" {
		t.Skip("set GOPHER_REDIS_LIVE=host:port (+GOPHER_REDIS_LIVE_PW) to run")
	}
	rdb := redis.NewClient(&redis.Options{
		Addr:     addr,
		Password: os.Getenv("GOPHER_REDIS_LIVE_PW"),
	})
	ctx := context.Background()
	if err := rdb.Ping(ctx).Err(); err != nil {
		t.Fatalf("ping %s: %v", addr, err)
	}

	redisx.SetClient(rdb)
	redisx.SetPrefix("gopher:livetest:")
	t.Cleanup(func() {
		keys, _ := rdb.Keys(context.Background(), "gopher:livetest:*").Result()
		if len(keys) > 0 {
			_ = rdb.Del(context.Background(), keys...).Err()
		}
		redisx.SetPrefix("gopher:")
		redisx.SetClient(nil)
	})

	bus := newRedisBus()
	id, _ := bus.NewRequest(ctx, "live-session")

	// Publish after a short delay to mimic the real SSE flow, then finish.
	go func() {
		time.Sleep(120 * time.Millisecond)
		bus.Publish(ctx, id, StreamEvent{Type: consts.EventReasoning, Content: "..."})
		bus.Publish(ctx, id, StreamEvent{Type: consts.EventDelta, Content: "hello live"})
		bus.Publish(ctx, id, StreamEvent{Type: consts.EventDone, Content: "hello live"})
		bus.Finish(ctx, id)
	}()

	var got []StreamEvent
	ok := bus.Subscribe(ctx, id, 0, func(e Event) error {
		got = append(got, e.Data)
		return nil
	})
	if !ok {
		t.Fatal("Subscribe returned false on live Redis")
	}
	if len(got) != 3 {
		t.Fatalf("expected 3 events, got %d: %+v", len(got), got)
	}
	for i, e := range got {
		if e.Seq != i+1 {
			t.Fatalf("seq mismatch at %d: %+v", i, got)
		}
	}
	if got[2].Type != consts.EventDone {
		t.Fatalf("last event should be done: %+v", got[2])
	}

	// Every key the app writes must carry a TTL (nothing may accumulate forever).
	setFlushWatermark(ctx, "live-sess", 7)
	wmKey := redisx.Key("mem", "flushed", "live-sess")
	if ttl, err := rdb.TTL(ctx, wmKey).Result(); err != nil || ttl <= 0 {
		t.Fatalf("flush watermark has no TTL: ttl=%v err=%v", ttl, err)
	}
	if v := flushWatermark(ctx, "live-sess"); v != 7 {
		t.Fatalf("flush watermark roundtrip failed: %d", v)
	}

	t.Logf("live redis bus OK: %d events over %s", len(got), addr)
}
