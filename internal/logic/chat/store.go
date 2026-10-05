package chat

import (
	"context"
	"time"

	"github.com/gogf/gf/v2/database/gdb"
	"github.com/gogf/gf/v2/frame/g"

	"GopherAgent/internal/consts"
	"GopherAgent/internal/store"
)

// Session is a persisted conversation.
type Session struct {
	ID            string
	Title         string
	CreatedAt     int64
	UpdatedAt     int64
	Pinned        bool
	ProjectDir    string
	Permission    string
	ModelProvider string
	ModelName     string
}

// SessionSummary is a session plus its message count.
type SessionSummary struct {
	Session
	MessageCount int
}

// Message is a persisted chat message. Seq doubles as its ordering key.
type Message struct {
	Seq       int64
	Role      string
	Content   string
	Thinking  string
	CreatedAt int64
}

// EnsureSession inserts the session when missing and returns it.
func EnsureSession(ctx context.Context, id string) (*Session, error) {
	if s, ok, err := GetSession(ctx, id); err != nil {
		return nil, err
	} else if ok {
		return s, nil
	}
	now := time.Now().Unix()
	_, err := store.DB().Model(consts.TableSessions).Ctx(ctx).Data(g.Map{
		"id":         id,
		"title":      "",
		"created_at": now,
		"updated_at": now,
		"pinned":     0,
	}).Insert()
	if err != nil {
		return nil, err
	}
	return &Session{ID: id, CreatedAt: now, UpdatedAt: now}, nil
}

// GetSession loads a session by id.
func GetSession(ctx context.Context, id string) (*Session, bool, error) {
	row, err := store.DB().Model(consts.TableSessions).Ctx(ctx).Where("id", id).One()
	if err != nil {
		return nil, false, err
	}
	if row.IsEmpty() {
		return nil, false, nil
	}
	return recordToSession(row), true, nil
}

// ListSessions returns a page of sessions ordered by pinned then recency.
func ListSessions(ctx context.Context, page, pageSize int) ([]SessionSummary, int, error) {
	if page < 1 {
		page = 1
	}
	if pageSize <= 0 {
		pageSize = 50
	}
	model := store.DB().Model(consts.TableSessions).Ctx(ctx)
	total, err := model.Count()
	if err != nil {
		return nil, 0, err
	}
	rows, err := model.
		Fields(
			"id", "title", "created_at", "updated_at", "pinned",
			"project_dir", "permission", "model_provider", "model_name",
			"(SELECT COUNT(*) FROM messages m WHERE m.session_id = sessions.id) AS message_count",
		).
		OrderDesc("pinned").
		OrderDesc("updated_at").
		Page(page, pageSize).
		All()
	if err != nil {
		return nil, 0, err
	}
	out := make([]SessionSummary, 0, len(rows))
	for _, row := range rows {
		out = append(out, SessionSummary{
			Session:      *recordToSession(row),
			MessageCount: row["message_count"].Int(),
		})
	}
	return out, total, nil
}

// UpdateSessionTitle updates the title.
func UpdateSessionTitle(ctx context.Context, id, title string) error {
	_, err := store.DB().Model(consts.TableSessions).Ctx(ctx).Where("id", id).Data(g.Map{
		"title":      title,
		"updated_at": time.Now().Unix(),
	}).Update()
	return err
}

// SetSessionPinned updates the pinned flag.
func SetSessionPinned(ctx context.Context, id string, pinned bool) error {
	v := 0
	if pinned {
		v = 1
	}
	_, err := store.DB().Model(consts.TableSessions).Ctx(ctx).Where("id", id).Data(g.Map{"pinned": v}).Update()
	return err
}

// UpdateSessionSettings stores per-session permission/model overrides.
func UpdateSessionSettings(ctx context.Context, id, permission, provider, model string) error {
	_, err := store.DB().Model(consts.TableSessions).Ctx(ctx).Where("id", id).Data(g.Map{
		"permission":     permission,
		"model_provider": provider,
		"model_name":     model,
	}).Update()
	return err
}

// DeleteSession removes a session and all of its messages.
func DeleteSession(ctx context.Context, id string) error {
	db := store.DB()
	if _, err := db.Model(consts.TableMessages).Ctx(ctx).Where("session_id", id).Delete(); err != nil {
		return err
	}
	_, err := db.Model(consts.TableSessions).Ctx(ctx).Where("id", id).Delete()
	return err
}

// AppendMessage inserts a message and bumps the session timestamp.
func AppendMessage(ctx context.Context, sessionID, role, content, thinking string) (int64, error) {
	now := time.Now().Unix()
	db := store.DB()
	seq, err := db.Model(consts.TableMessages).Ctx(ctx).Data(g.Map{
		"session_id": sessionID,
		"role":       role,
		"content":    content,
		"thinking":   thinking,
		"created_at": now,
	}).InsertAndGetId()
	if err != nil {
		return 0, err
	}
	_, _ = db.Model(consts.TableSessions).Ctx(ctx).Where("id", sessionID).Data(g.Map{"updated_at": now}).Update()
	return seq, nil
}

// ListMessages returns a page of messages in ascending order. Page 1 is the
// most recent window; higher pages walk backwards in time.
func ListMessages(ctx context.Context, sessionID string, page, pageSize int) ([]Message, int, error) {
	if page < 1 {
		page = 1
	}
	if pageSize <= 0 {
		pageSize = 20
	}
	total, err := store.DB().Model(consts.TableMessages).Ctx(ctx).Where("session_id", sessionID).Count()
	if err != nil {
		return nil, 0, err
	}
	rows, err := store.DB().Model(consts.TableMessages).Ctx(ctx).
		Where("session_id", sessionID).
		OrderDesc("seq").
		Page(page, pageSize).
		All()
	if err != nil {
		return nil, 0, err
	}
	return reverseMessages(rows), total, nil
}

// RecentMessages returns the last limit messages in ascending order.
func RecentMessages(ctx context.Context, sessionID string, limit int) ([]Message, error) {
	if limit <= 0 {
		limit = 60
	}
	rows, err := store.DB().Model(consts.TableMessages).Ctx(ctx).
		Where("session_id", sessionID).
		OrderDesc("seq").
		Limit(limit).
		All()
	if err != nil {
		return nil, err
	}
	return reverseMessages(rows), nil
}

// MessageCount returns the number of messages in a session.
func MessageCount(ctx context.Context, sessionID string) (int64, error) {
	n, err := store.DB().Model(consts.TableMessages).Ctx(ctx).Where("session_id", sessionID).Count()
	return int64(n), err
}

// FirstUserMessage returns the earliest user message content, if any.
func FirstUserMessage(ctx context.Context, sessionID string) string {
	row, err := store.DB().Model(consts.TableMessages).Ctx(ctx).
		Where("session_id", sessionID).
		Where("role", consts.RoleUser).
		OrderAsc("seq").
		Limit(1).
		One()
	if err != nil || row.IsEmpty() {
		return ""
	}
	return row["content"].String()
}

// DeleteMessages removes specific messages (or all when all is true).
func DeleteMessages(ctx context.Context, sessionID string, seqs []int64, all bool) error {
	model := store.DB().Model(consts.TableMessages).Ctx(ctx).Where("session_id", sessionID)
	if all {
		_, err := model.Delete()
		return err
	}
	if len(seqs) == 0 {
		return nil
	}
	args := make([]interface{}, len(seqs))
	for i, seq := range seqs {
		args[i] = seq
	}
	_, err := model.WhereIn("seq", args).Delete()
	return err
}

func reverseMessages(rows gdb.Result) []Message {
	out := make([]Message, 0, len(rows))
	for i := len(rows) - 1; i >= 0; i-- {
		row := rows[i]
		out = append(out, Message{
			Seq:       row["seq"].Int64(),
			Role:      row["role"].String(),
			Content:   row["content"].String(),
			Thinking:  row["thinking"].String(),
			CreatedAt: row["created_at"].Int64(),
		})
	}
	return out
}

func recordToSession(row gdb.Record) *Session {
	return &Session{
		ID:            row["id"].String(),
		Title:         row["title"].String(),
		CreatedAt:     row["created_at"].Int64(),
		UpdatedAt:     row["updated_at"].Int64(),
		Pinned:        row["pinned"].Bool(),
		ProjectDir:    row["project_dir"].String(),
		Permission:    row["permission"].String(),
		ModelProvider: row["model_provider"].String(),
		ModelName:     row["model_name"].String(),
	}
}
