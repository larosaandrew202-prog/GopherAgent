package chat

import (
	"context"
	"sync"
	"time"

	"github.com/gogf/gf/v2/util/guid"
)

// Event is one SSE frame published for a request.
type Event struct {
	Seq  int
	Data StreamEvent
}

type streamState struct {
	mu        sync.Mutex
	cond      *sync.Cond
	events    []Event
	done      bool
	seq       int
	createdAt time.Time
}

func newStreamState() *streamState {
	s := &streamState{createdAt: time.Now()}
	s.cond = sync.NewCond(&s.mu)
	return s
}

func (s *streamState) append(event StreamEvent) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.seq++
	event.Seq = s.seq
	s.events = append(s.events, Event{Seq: s.seq, Data: event})
	s.cond.Broadcast()
}

func (s *streamState) close() {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.done = true
	s.cond.Broadcast()
}

// subscribe replays events after afterSeq and then streams new ones until the
// state is closed or ctx is cancelled.
func (s *streamState) subscribe(ctx context.Context, afterSeq int, emit func(Event) error) error {
	stop := make(chan struct{})
	defer close(stop)
	go func() {
		select {
		case <-ctx.Done():
		case <-stop:
		}
		s.mu.Lock()
		s.cond.Broadcast()
		s.mu.Unlock()
	}()

	cursor := afterSeq
	for {
		s.mu.Lock()
		var pending []Event
		for _, e := range s.events {
			if e.Seq > cursor {
				pending = append(pending, e)
			}
		}
		if len(pending) == 0 {
			if s.done {
				s.mu.Unlock()
				return nil
			}
			s.cond.Wait()
			s.mu.Unlock()
			if ctx.Err() != nil {
				return ctx.Err()
			}
			continue
		}
		s.mu.Unlock()

		for _, e := range pending {
			if err := emit(e); err != nil {
				return err
			}
			cursor = e.Seq
		}
	}
}

// Hub tracks in-flight request event streams and their cancels.
type Hub struct {
	mu        sync.Mutex
	streams   map[string]*streamState
	cancels   map[string]context.CancelFunc
	bySession map[string]string
	janitor   sync.Once
}

func newHub() *Hub {
	return &Hub{
		streams:   make(map[string]*streamState),
		cancels:   make(map[string]context.CancelFunc),
		bySession: make(map[string]string),
	}
}

// NewRequest registers a cancellable request and returns its id/context.
func (h *Hub) NewRequest(_ context.Context, sessionID string) (string, context.Context) {
	h.janitor.Do(h.startJanitor)
	ctx, cancel := context.WithCancel(context.Background())
	id := guid.S()

	h.mu.Lock()
	// Cancel any previous request for the same session.
	if prev, ok := h.bySession[sessionID]; ok {
		if c, ok := h.cancels[prev]; ok {
			c()
		}
	}
	h.streams[id] = newStreamState()
	h.cancels[id] = cancel
	h.bySession[sessionID] = id
	h.mu.Unlock()

	return id, ctx
}

// Publish appends an event to a request stream.
func (h *Hub) Publish(_ context.Context, id string, event StreamEvent) {
	h.mu.Lock()
	state := h.streams[id]
	h.mu.Unlock()
	if state != nil {
		state.append(event)
	}
}

// Finish marks a request stream complete and forgets its cancel.
func (h *Hub) Finish(_ context.Context, id string) {
	h.mu.Lock()
	state := h.streams[id]
	delete(h.cancels, id)
	for sid, rid := range h.bySession {
		if rid == id {
			delete(h.bySession, sid)
		}
	}
	h.mu.Unlock()
	if state != nil {
		state.close()
	}
}

// Cancel cancels the active request for a session (or a specific request id).
func (h *Hub) Cancel(_ context.Context, sessionID, requestID string) bool {
	h.mu.Lock()
	id := requestID
	if id == "" {
		id = h.bySession[sessionID]
	}
	cancel, ok := h.cancels[id]
	h.mu.Unlock()
	if ok {
		cancel()
	}
	return ok
}

// Subscribe streams events for a request. It returns false when unknown.
func (h *Hub) Subscribe(ctx context.Context, id string, afterSeq int, emit func(Event) error) bool {
	h.mu.Lock()
	state := h.streams[id]
	h.mu.Unlock()
	if state == nil {
		return false
	}
	_ = state.subscribe(ctx, afterSeq, emit)
	return true
}

func (h *Hub) startJanitor() {
	go func() {
		ticker := time.NewTicker(time.Minute)
		defer ticker.Stop()
		for range ticker.C {
			cutoff := time.Now().Add(-10 * time.Minute)
			h.mu.Lock()
			for id, state := range h.streams {
				state.mu.Lock()
				stale := state.done && state.createdAt.Before(cutoff)
				state.mu.Unlock()
				if stale {
					delete(h.streams, id)
				}
			}
			h.mu.Unlock()
		}
	}()
}
