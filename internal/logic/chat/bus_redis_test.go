package chat

import (
	"context"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/redis/go-redis/v9"

	"GopherAgent/internal/consts"
	"GopherAgent/internal/logic/redisx"
)

// withMiniRedis points the shared redis client at an in-process Redis for the
// duration of a test.
func withMiniRedis(t *testing.T) *miniredis.Miniredis {
	t.Helper()
	mr := miniredis.RunT(t)
	rdb := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	redisx.SetClient(rdb)
	t.Cleanup(func() { redisx.SetClient(nil) })
	return mr
}

func TestRedisBusPublishSubscribe(t *testing.T) {
	withMiniRedis(t)
	bus := newRedisBus()
	ctx := context.Background()

	id, _ := bus.NewRequest(ctx, "sess-pubsub")

	// Subscriber arrives before any event: it must still find the request.
	done := make(chan struct{})
	go func() {
		defer close(done)
		time.Sleep(80 * time.Millisecond)
		bus.Publish(ctx, id, StreamEvent{Type: consts.EventReasoning, Content: "thinking"})
		bus.Publish(ctx, id, StreamEvent{Type: consts.EventDelta, Content: "hello"})
		bus.Publish(ctx, id, StreamEvent{Type: consts.EventDone, Content: "hello"})
		bus.Finish(ctx, id)
	}()

	var got []StreamEvent
	ok := bus.Subscribe(ctx, id, 0, func(e Event) error {
		got = append(got, e.Data)
		return nil
	})
	if !ok {
		t.Fatal("Subscribe returned false for a freshly created request")
	}
	<-done

	if len(got) != 3 {
		t.Fatalf("expected 3 events, got %d: %+v", len(got), got)
	}
	if got[0].Seq != 1 || got[1].Seq != 2 || got[2].Seq != 3 {
		t.Fatalf("seq not monotonic: %+v", got)
	}
	if got[1].Content != "hello" || got[2].Type != consts.EventDone {
		t.Fatalf("event payload wrong: %+v", got)
	}
}

func TestRedisBusReplayFromCursor(t *testing.T) {
	withMiniRedis(t)
	bus := newRedisBus()
	ctx := context.Background()

	id, _ := bus.NewRequest(ctx, "sess-replay")
	for i := 0; i < 5; i++ {
		bus.Publish(ctx, id, StreamEvent{Type: consts.EventDelta, Content: "x"})
	}
	bus.Finish(ctx, id)

	// Reconnect asking only for events after seq 3.
	var got []StreamEvent
	ok := bus.Subscribe(ctx, id, 3, func(e Event) error {
		got = append(got, e.Data)
		return nil
	})
	if !ok {
		t.Fatal("Subscribe returned false for a finished request")
	}
	if len(got) != 2 || got[0].Seq != 4 || got[1].Seq != 5 {
		t.Fatalf("replay after seq 3 wrong: %+v", got)
	}
}

func TestRedisBusUnknownRequest(t *testing.T) {
	withMiniRedis(t)
	bus := newRedisBus()
	if ok := bus.Subscribe(context.Background(), "nope", 0, func(Event) error { return nil }); ok {
		t.Fatal("Subscribe should return false for an unknown request id")
	}
}

func TestRedisBusCancel(t *testing.T) {
	withMiniRedis(t)
	bus := newRedisBus()
	ctx := context.Background()

	_, reqCtx := bus.NewRequest(ctx, "sess-cancel")
	// Let the cancel watcher establish its subscription.
	time.Sleep(120 * time.Millisecond)

	if !bus.Cancel(ctx, "sess-cancel", "") {
		t.Fatal("Cancel reported it found nothing")
	}
	select {
	case <-reqCtx.Done():
	case <-time.After(2 * time.Second):
		t.Fatal("request context was not cancelled")
	}
}

func TestRedisBusCancelBeforeWatcher(t *testing.T) {
	withMiniRedis(t)
	bus := newRedisBus()
	ctx := context.Background()

	id, reqCtx := bus.NewRequest(ctx, "sess-race")
	// Cancel immediately, before the watcher has a chance to subscribe.
	bus.Cancel(ctx, "", id)

	select {
	case <-reqCtx.Done():
	case <-time.After(2 * time.Second):
		t.Fatal("cancel flag was not honoured")
	}
}
