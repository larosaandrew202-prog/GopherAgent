package chat

import (
	"context"
	"sync"

	"github.com/gogf/gf/v2/frame/g"

	"GopherAgent/internal/logic/redisx"
)

// Bus abstracts the in-flight request event hub. The default implementation is
// process-local (Hub); when Redis is configured, RedisBus distributes events
// and cancels across instances while keeping the same call surface.
//
// Event streams are keyed by request id and support replay from a cursor
// (afterSeq) so the console can reconnect and resume.
type Bus interface {
	// NewRequest registers a cancellable request for sessionID, cancelling any
	// previous request for the same session, and returns its id and a context
	// that Cancel will cancel.
	NewRequest(ctx context.Context, sessionID string) (id string, reqCtx context.Context)
	// Publish appends one event to the request's stream.
	Publish(ctx context.Context, id string, event StreamEvent)
	// Finish marks the request stream complete and forgets its resources.
	Finish(ctx context.Context, id string)
	// Cancel cancels the active request for a session (or a specific id).
	Cancel(ctx context.Context, sessionID, requestID string) bool
	// Subscribe replays events after afterSeq and then streams new ones until
	// the stream is done or ctx is cancelled. Returns false for unknown ids.
	Subscribe(ctx context.Context, id string, afterSeq int, emit func(Event) error) bool
}

var (
	busMu      sync.RWMutex
	defaultHub Bus = newHub()
)

// HubInstance returns the process-wide bus.
func HubInstance() Bus {
	busMu.RLock()
	defer busMu.RUnlock()
	return defaultHub
}

// InitBus selects the bus implementation: Redis when configured and reachable,
// otherwise the process-local hub. Call once at startup.
func InitBus(ctx context.Context) {
	var b Bus = newHub()
	if redisx.Enabled() {
		b = newRedisBus()
		g.Log().Info(ctx, "chat bus: redis (multi-node)")
	} else {
		g.Log().Info(ctx, "chat bus: memory (single-node)")
	}
	busMu.Lock()
	defaultHub = b
	busMu.Unlock()
}
