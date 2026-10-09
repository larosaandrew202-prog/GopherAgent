package chat

import (
	"context"
	"testing"

	"GopherAgent/internal/logic/redisx"
)

func TestFlushWatermarkRedis(t *testing.T) {
	withMiniRedis(t)
	ctx := context.Background()

	if v := flushWatermark(ctx, "s1"); v != 0 {
		t.Fatalf("expected cold watermark 0, got %d", v)
	}
	setFlushWatermark(ctx, "s1", 42)
	if v := flushWatermark(ctx, "s1"); v != 42 {
		t.Fatalf("expected 42, got %d", v)
	}
	// Sessions are independent.
	if v := flushWatermark(ctx, "s2"); v != 0 {
		t.Fatalf("expected s2 cold watermark 0, got %d", v)
	}
	_ = redisx.Client()
}
