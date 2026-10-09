package chat

import (
	"context"
	"encoding/json"
	"sync"
	"time"

	"github.com/gogf/gf/v2/frame/g"
	"github.com/gogf/gf/v2/util/guid"

	"GopherAgent/internal/logic/redisx"
)

// redisStreamTTL bounds how long a finished/interrupted request's keys live, so
// abandoned streams self-clean without a janitor goroutine.
const redisStreamTTL = 15 * time.Minute

// redisDoneSentinel is published on the request channel when Finish runs.
const redisDoneSentinel = `{"__eof":true}`

// redisBus is the Redis-backed Bus. Events are stored in a per-request list
// (for replay by seq) and fanned out over Pub/Sub (for live delivery). Only the
// bookkeeping for local cancel-watcher goroutines stays in memory.
type redisBus struct {
	mu      sync.Mutex
	watches map[string]context.CancelFunc
}

func newRedisBus() *redisBus {
	return &redisBus{watches: make(map[string]context.CancelFunc)}
}

func keyStream(id string) string    { return redisx.Key("req", "events", id) }
func keySeq(id string) string       { return redisx.Key("req", "seq", id) }
func keyChan(id string) string      { return redisx.Key("req", "ch", id) }
func keyDone(id string) string      { return redisx.Key("req", "done", id) }
func keyReq(id string) string       { return redisx.Key("req", "exists", id) }
func keyCancel(id string) string    { return redisx.Key("req", "cancel", id) }
func keyCancelled(id string) string { return redisx.Key("req", "cancelled", id) }
func keyActive(sid string) string   { return redisx.Key("sess", "active", sid) }

func (b *redisBus) NewRequest(ctx context.Context, sessionID string) (string, context.Context) {
	id := guid.S()
	reqCtx, cancel := context.WithCancel(context.Background())

	// Register this request's local cleanup so nothing leaks on any path: the
	// watcher stop func plus the request cancel are released by Finish.
	watchCtx, stopWatch := context.WithCancel(context.Background())
	b.mu.Lock()
	b.watches[id] = func() {
		stopWatch()
		cancel()
	}
	b.mu.Unlock()

	rdb := redisx.Client()
	if rdb == nil {
		return id, reqCtx
	}

	// Cancel any previous request for the same session, even on another node.
	// keyReq marks the request as existing so a subscriber that arrives before
	// the first event still finds it.
	_ = rdb.Set(ctx, keyReq(id), "1", redisStreamTTL).Err()
	if sessionID != "" {
		if prev, err := rdb.Get(ctx, keyActive(sessionID)).Result(); err == nil && prev != "" && prev != id {
			_ = rdb.Publish(ctx, keyCancel(prev), "1").Err()
		}
		_ = rdb.Set(ctx, keyActive(sessionID), id, redisStreamTTL).Err()
	}

	// Watch the cancel channel so a Cancel from any node stops this run.
	go b.watchCancel(watchCtx, id, cancel)

	return id, reqCtx
}

func (b *redisBus) watchCancel(ctx context.Context, id string, cancel context.CancelFunc) {
	rdb := redisx.Client()
	if rdb == nil {
		return
	}
	// Close the subscribe race: honour a cancel that landed before we subscribed.
	if flag, err := rdb.Get(ctx, keyCancelled(id)).Result(); err == nil && flag != "" {
		cancel()
		return
	}
	sub := rdb.Subscribe(ctx, keyCancel(id))
	defer sub.Close()
	ch := sub.Channel()
	for {
		select {
		case <-ctx.Done():
			return
		case _, ok := <-ch:
			if !ok {
				return
			}
			cancel()
			return
		}
	}
}

func (b *redisBus) Publish(ctx context.Context, id string, event StreamEvent) {
	rdb := redisx.Client()
	if rdb == nil {
		return
	}
	seq, err := rdb.Incr(ctx, keySeq(id)).Result()
	if err != nil {
		g.Log().Warningf(ctx, "redis bus: incr seq for %s: %v", id, err)
		return
	}
	event.Seq = int(seq)
	data, err := json.Marshal(Event{Seq: int(seq), Data: event})
	if err != nil {
		return
	}
	pipe := rdb.Pipeline()
	pipe.RPush(ctx, keyStream(id), data)
	pipe.Expire(ctx, keyStream(id), redisStreamTTL)
	pipe.Expire(ctx, keySeq(id), redisStreamTTL)
	pipe.Publish(ctx, keyChan(id), data)
	if _, err := pipe.Exec(ctx); err != nil {
		g.Log().Warningf(ctx, "redis bus: publish for %s: %v", id, err)
	}
}

func (b *redisBus) Finish(ctx context.Context, id string) {
	rdb := redisx.Client()
	if rdb != nil {
		pipe := rdb.Pipeline()
		pipe.Set(ctx, keyDone(id), "1", redisStreamTTL)
		pipe.Expire(ctx, keyStream(id), redisStreamTTL)
		pipe.Publish(ctx, keyChan(id), redisDoneSentinel)
		_, _ = pipe.Exec(ctx)
	}

	b.mu.Lock()
	if stop, ok := b.watches[id]; ok {
		stop()
		delete(b.watches, id)
	}
	b.mu.Unlock()
}

func (b *redisBus) Cancel(ctx context.Context, sessionID, requestID string) bool {
	rdb := redisx.Client()
	if rdb == nil {
		return false
	}
	id := requestID
	if id == "" {
		if sessionID == "" {
			return false
		}
		got, err := rdb.Get(ctx, keyActive(sessionID)).Result()
		if err != nil || got == "" {
			return false
		}
		id = got
	}
	if err := rdb.Publish(ctx, keyCancel(id), "1").Err(); err != nil {
		g.Log().Warningf(ctx, "redis bus: cancel %s: %v", id, err)
		return false
	}
	// Persist the cancel flag so a watcher that is not yet subscribed still sees it.
	_ = rdb.Set(ctx, keyCancelled(id), "1", redisStreamTTL).Err()
	return true
}

func (b *redisBus) Subscribe(ctx context.Context, id string, afterSeq int, emit func(Event) error) bool {
	rdb := redisx.Client()
	if rdb == nil {
		return false
	}
	metaN, _ := rdb.Exists(ctx, keyReq(id)).Result()
	streamN, _ := rdb.Exists(ctx, keyStream(id)).Result()
	doneN, _ := rdb.Exists(ctx, keyDone(id)).Result()
	if metaN == 0 && streamN == 0 && doneN == 0 {
		return false
	}

	// Subscribe before replaying so nothing published after this point is lost.
	sub := rdb.Subscribe(ctx, keyChan(id))
	defer sub.Close()
	ch := sub.Channel()

	cursor := afterSeq
	replay := func() error {
		items, err := rdb.LRange(ctx, keyStream(id), 0, -1).Result()
		if err != nil {
			return nil
		}
		for _, raw := range items {
			var e Event
			if json.Unmarshal([]byte(raw), &e) != nil {
				continue
			}
			if e.Seq <= cursor {
				continue
			}
			if err := emit(e); err != nil {
				return err
			}
			cursor = e.Seq
		}
		return nil
	}
	if err := replay(); err != nil {
		return true
	}

	handle := func(payload string) (done bool, err error) {
		if payload == redisDoneSentinel {
			return true, nil
		}
		var e Event
		if json.Unmarshal([]byte(payload), &e) != nil {
			return false, nil
		}
		if e.Seq <= cursor {
			return false, nil
		}
		if err := emit(e); err != nil {
			return true, err
		}
		cursor = e.Seq
		return false, nil
	}

	// Already finished: drain buffered messages briefly, then return.
	if doneN > 0 {
		deadline := time.After(300 * time.Millisecond)
		for {
			select {
			case <-ctx.Done():
				return true
			case <-deadline:
				return true
			case msg, ok := <-ch:
				if !ok {
					return true
				}
				done, err := handle(msg.Payload)
				if done || err != nil {
					return true
				}
			}
		}
	}

	for {
		select {
		case <-ctx.Done():
			return true
		case msg, ok := <-ch:
			if !ok {
				return true
			}
			done, err := handle(msg.Payload)
			if done || err != nil {
				return true
			}
		}
	}
}
