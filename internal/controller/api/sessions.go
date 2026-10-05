package api

import (
	"strings"

	"github.com/gogf/gf/v2/frame/g"
	"github.com/gogf/gf/v2/net/ghttp"
	"github.com/gogf/gf/v2/util/gconv"

	"GopherAgent/internal/consts"
	chatlogic "GopherAgent/internal/logic/chat"
	"GopherAgent/internal/logic/config"
)

// ListSessions lists conversations, newest first.
func ListSessions(r *ghttp.Request) {
	if !requireAuth(r) {
		return
	}
	page := r.Get("page").Int()
	pageSize := r.Get("page_size").Int()
	if page < 1 {
		page = 1
	}
	if pageSize <= 0 {
		pageSize = 50
	}

	items, total, err := chatlogic.ListSessions(r.Context(), page, pageSize)
	if err != nil {
		fail(r, err.Error())
		return
	}
	sessions := make([]g.Map, 0, len(items))
	for _, item := range items {
		sessions = append(sessions, sessionMap(item))
	}
	writeJSON(r, g.Map{
		"status":        consts.StatusSuccess,
		"sessions":      sessions,
		"total":         total,
		"has_more":      page*pageSize < total,
		"projects":      []interface{}{},
		"project_order": []string{},
	})
}

// GetSession returns a single session.
func GetSession(r *ghttp.Request) {
	if !requireAuth(r) {
		return
	}
	id := sessionIDFromPath(r)
	s, found, err := chatlogic.GetSession(r.Context(), id)
	if err != nil {
		fail(r, err.Error())
		return
	}
	if !found {
		writeJSON(r, g.Map{"status": consts.StatusSuccess, "session_id": id, "title": ""})
		return
	}
	writeJSON(r, g.Map{
		"status":        consts.StatusSuccess,
		"session_id":    s.ID,
		"title":         s.Title,
		"created_at":    s.CreatedAt * 1000,
		"updated_at":    s.UpdatedAt * 1000,
		"pinned":        s.Pinned,
		"project_dir":   nilIfEmpty(s.ProjectDir),
		"message_count": 0,
	})
}

// UpdateSession renames or pins a session.
func UpdateSession(r *ghttp.Request) {
	if !requireAuth(r) {
		return
	}
	id := sessionIDFromPath(r)
	var body struct {
		Title  *string `json:"title"`
		Pinned *bool   `json:"pinned"`
	}
	_ = parseBody(r, &body)

	_, found, err := chatlogic.GetSession(r.Context(), id)
	if err != nil {
		fail(r, err.Error())
		return
	}
	if !found {
		_, _ = chatlogic.EnsureSession(r.Context(), id)
	}
	if body.Title != nil {
		_ = chatlogic.UpdateSessionTitle(r.Context(), id, *body.Title)
	}
	if body.Pinned != nil {
		_ = chatlogic.SetSessionPinned(r.Context(), id, *body.Pinned)
	}
	ok(r, g.Map{})
}

// DeleteSession removes a session.
func DeleteSession(r *ghttp.Request) {
	if !requireAuth(r) {
		return
	}
	id := sessionIDFromPath(r)
	if err := chatlogic.DeleteSession(r.Context(), id); err != nil {
		fail(r, err.Error())
		return
	}
	ok(r, g.Map{})
}

// ClearContext removes all messages from a session.
func ClearContext(r *ghttp.Request) {
	if !requireAuth(r) {
		return
	}
	id := sessionIDFromPath(r)
	if err := chatlogic.DeleteMessages(r.Context(), id, nil, true); err != nil {
		fail(r, err.Error())
		return
	}
	ok(r, g.Map{})
}

// GenerateTitle (re)derives a session title from its first user message.
func GenerateTitle(r *ghttp.Request) {
	if !requireAuth(r) {
		return
	}
	id := sessionIDFromPath(r)
	if first := chatlogic.FirstUserMessage(r.Context(), id); first != "" {
		title := strings.TrimSpace(first)
		if runes := []rune(title); len(runes) > 30 {
			title = string(runes[:30])
		}
		_ = chatlogic.UpdateSessionTitle(r.Context(), id, title)
	}
	ok(r, g.Map{})
}

// GetSessionSettings returns per-session and global model/permission settings.
func GetSessionSettings(r *ghttp.Request) {
	if !requireAuth(r) {
		return
	}
	id := sessionIDFromPath(r)
	s, found, err := chatlogic.GetSession(r.Context(), id)
	if err != nil {
		fail(r, err.Error())
		return
	}
	writeJSON(r, g.Map{
		"status":            consts.StatusSuccess,
		"permission":        sessionPermission(s, found),
		"model":             sessionModel(s, found),
		"global_permission": normalizePermission(config.C().GetString(consts.CfgAgentPermissionMode)),
		"global_model":      globalModel(),
	})
}

// UpdateSessionSettings stores per-session overrides.
func UpdateSessionSettings(r *ghttp.Request) {
	if !requireAuth(r) {
		return
	}
	id := sessionIDFromPath(r)
	var body struct {
		Permission *string `json:"permission"`
		Model      *struct {
			Provider string `json:"provider"`
			Model    string `json:"model"`
		} `json:"model"`
	}
	_ = parseBody(r, &body)

	s, found, err := chatlogic.GetSession(r.Context(), id)
	if err != nil {
		fail(r, err.Error())
		return
	}
	if !found {
		s, _ = chatlogic.EnsureSession(r.Context(), id)
	}

	permission := s.Permission
	if body.Permission != nil {
		if *body.Permission == consts.PermissionGlobal {
			permission = ""
		} else {
			permission = normalizePermission(*body.Permission)
		}
	}
	provider, model := s.ModelProvider, s.ModelName
	if body.Model != nil {
		provider, model = body.Model.Provider, body.Model.Model
	}
	if err := chatlogic.UpdateSessionSettings(r.Context(), id, permission, provider, model); err != nil {
		fail(r, err.Error())
		return
	}

	s, _, _ = chatlogic.GetSession(r.Context(), id)
	writeJSON(r, g.Map{
		"status":            consts.StatusSuccess,
		"permission":        sessionPermission(s, true),
		"model":             sessionModel(s, true),
		"global_permission": normalizePermission(config.C().GetString(consts.CfgAgentPermissionMode)),
		"global_model":      globalModel(),
	})
}

// History returns a page of a session's messages.
func History(r *ghttp.Request) {
	if !requireAuth(r) {
		return
	}
	sessionID := r.Get("session_id").String()
	page := r.Get("page").Int()
	pageSize := r.Get("page_size").Int()
	if page < 1 {
		page = 1
	}
	if pageSize <= 0 {
		pageSize = 20
	}

	msgs, total, err := chatlogic.ListMessages(r.Context(), sessionID, page, pageSize)
	if err != nil {
		fail(r, err.Error())
		return
	}
	out := make([]g.Map, 0, len(msgs))
	for _, m := range msgs {
		item := g.Map{
			"seq":       m.Seq,
			"role":      m.Role,
			"content":   m.Content,
			"timestamp": m.CreatedAt * 1000,
		}
		if m.Thinking != "" {
			item["thinking"] = m.Thinking
		}
		out = append(out, item)
	}
	writeJSON(r, g.Map{
		"status":   consts.StatusSuccess,
		"messages": out,
		"has_more": page*pageSize < total,
		"total":    total,
		"page":     page,
	})
}

// DeleteMessagesHandler deletes specific (or all) messages of a session.
func DeleteMessagesHandler(r *ghttp.Request) {
	if !requireAuth(r) {
		return
	}
	var body struct {
		SessionID  string        `json:"session_id"`
		Seqs       []interface{} `json:"seqs"`
		MessageIDs []interface{} `json:"message_ids"`
		All        bool          `json:"all"`
	}
	_ = parseBody(r, &body)

	seqs := make([]int64, 0, len(body.Seqs)+len(body.MessageIDs))
	for _, raw := range append(body.Seqs, body.MessageIDs...) {
		if v := gconv.Int64(raw); v != 0 {
			seqs = append(seqs, v)
		}
	}
	if err := chatlogic.DeleteMessages(r.Context(), body.SessionID, seqs, body.All); err != nil {
		fail(r, err.Error())
		return
	}
	ok(r, g.Map{})
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

func sessionIDFromPath(r *ghttp.Request) string {
	if id := r.GetRouter("id").String(); id != "" {
		return id
	}
	return r.Get("id").String()
}

func sessionMap(item chatlogic.SessionSummary) g.Map {
	return g.Map{
		"session_id":      item.ID,
		"title":           item.Title,
		"created_at":      item.CreatedAt * 1000,
		"updated_at":      item.UpdatedAt * 1000,
		"last_message_at": item.UpdatedAt * 1000,
		"pinned":          item.Pinned,
		"project_dir":     nilIfEmpty(item.ProjectDir),
		"message_count":   item.MessageCount,
	}
}

func sessionPermission(s *chatlogic.Session, found bool) interface{} {
	if !found || s == nil || s.Permission == "" {
		return consts.PermissionGlobal
	}
	return normalizePermission(s.Permission)
}

func sessionModel(s *chatlogic.Session, found bool) interface{} {
	if !found || s == nil || s.ModelName == "" {
		return nil
	}
	return g.Map{"provider": s.ModelProvider, "model": s.ModelName}
}

func globalModel() g.Map {
	s := config.C()
	model := s.GetString(consts.CfgModel)
	provider := s.GetString(consts.CfgBotType)
	if provider == "" {
		if p := config.InferProvider(model); p != nil {
			provider = p.ID
		}
	}
	return g.Map{"provider": provider, "model": model}
}

func nilIfEmpty(v string) interface{} {
	if v == "" {
		return nil
	}
	return v
}
