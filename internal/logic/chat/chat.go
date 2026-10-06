// Package chat implements multi-session chat on top of the OpenAI-compatible
// LLM client. It persists sessions and messages in SQLite, runs an agent loop
// that can invoke local tools, and streams events over an SSE hub.
package chat

import (
	"context"
	"encoding/json"
	"fmt"
	"regexp"
	"strings"
	"sync"
	"time"

	"GopherAgent/internal/consts"
	"GopherAgent/internal/logic/config"
	"GopherAgent/internal/logic/llm"
	"GopherAgent/internal/logic/memory"
	"GopherAgent/internal/logic/paths"
	"GopherAgent/internal/logic/tools"
)

// Attachment references an uploaded file included with a message.
type Attachment struct {
	FilePath string
	FileType string
	FileName string
}

// SendRequest is an inbound chat message.
type SendRequest struct {
	SessionID   string
	Message     string
	Attachments []Attachment
	IsVoice     bool
	Steer       bool
}

// SendResult is returned immediately; streamed content arrives via the hub.
type SendResult struct {
	RequestID   string
	Stream      bool
	InlineReply string
	Steered     bool
}

// ErrNoAPIKey signals that no usable provider credential is configured.
var ErrNoAPIKey = fmt.Errorf("no API key configured")

// publisher emits one agent event; it is nil-safe.
type publisher func(event map[string]interface{})

func (p publisher) emit(event map[string]interface{}) {
	if p != nil {
		p(event)
	}
}

// Send persists the user turn and starts an asynchronous agent reply.
func Send(ctx context.Context, req SendRequest) (*SendResult, error) {
	message := strings.TrimSpace(req.Message)
	sessionID := strings.TrimSpace(req.SessionID)
	if sessionID == "" {
		sessionID = fmt.Sprintf("session_%d", time.Now().UnixNano())
	}

	session, err := EnsureSession(ctx, sessionID)
	if err != nil {
		return nil, err
	}

	lower := strings.ToLower(message)
	switch {
	case lower == consts.CommandCancel:
		defaultHub.Cancel(sessionID, "")
		return &SendResult{InlineReply: "已取消"}, nil
	case strings.HasPrefix(lower, consts.CommandMemory):
		return handleMemoryCommand(ctx, message), nil
	case isClearCommand(message):
		_ = DeleteMessages(ctx, sessionID, nil, true)
		return &SendResult{InlineReply: "记忆已清除"}, nil
	case message == consts.CommandReloadConfig:
		config.C().Reload()
		return &SendResult{InlineReply: "配置已更新"}, nil
	case req.Steer:
		return &SendResult{InlineReply: "引导已注入", Steered: true}, nil
	}

	if message == "" && len(req.Attachments) == 0 {
		return nil, fmt.Errorf("message is required")
	}

	content := message
	if refs := attachmentRefs(req.Attachments); refs != "" {
		content = strings.TrimSpace(content + "\n" + refs)
	}

	if _, err := AppendMessage(ctx, sessionID, consts.RoleUser, content, ""); err != nil {
		return nil, err
	}
	if strings.TrimSpace(session.Title) == "" {
		if title := makeTitle(message); title != "" {
			_ = UpdateSessionTitle(ctx, sessionID, title)
		}
	}

	requestID, reqCtx := defaultHub.NewRequest(sessionID)
	go runAgent(reqCtx, requestID, sessionID, session)

	return &SendResult{RequestID: requestID, Stream: true}, nil
}

// Cancel cancels an in-flight request.
func Cancel(ctx context.Context, sessionID, requestID string) bool {
	return defaultHub.Cancel(sessionID, requestID)
}

// RunTask runs one agent turn synchronously (used by the scheduler) and returns
// the final assistant text.
func RunTask(ctx context.Context, sessionID, prompt string) (string, error) {
	session, err := EnsureSession(ctx, sessionID)
	if err != nil {
		return "", err
	}
	if _, err := AppendMessage(ctx, sessionID, consts.RoleUser, prompt, ""); err != nil {
		return "", err
	}
	outcome, err := runAgentLoop(ctx, sessionID, session, nil)
	if err != nil {
		return "", err
	}
	return outcome.Content, nil
}

// ---------------------------------------------------------------------------
// agent loop
// ---------------------------------------------------------------------------

type agentOutcome struct {
	Content string
	Model   string
	Usage   llm.Usage
}

// runAgent runs the tool loop and publishes SSE events.
func runAgent(ctx context.Context, requestID, sessionID string, session *Session) {
	defer defaultHub.Finish(requestID)
	pub := publisher(func(event map[string]interface{}) { defaultHub.Publish(requestID, event) })

	outcome, err := runAgentLoop(ctx, sessionID, session, pub)
	if err != nil {
		if ctx.Err() != nil {
			pub.emit(map[string]interface{}{"type": consts.EventCancelled})
		} else {
			pub.emit(map[string]interface{}{"type": consts.EventError, "message": err.Error()})
		}
		return
	}

	pub.emit(map[string]interface{}{
		"type":       consts.EventDone,
		"content":    outcome.Content,
		"session_id": sessionID,
		"model":      outcome.Model,
		"usage": map[string]int{
			"prompt_tokens":     outcome.Usage.PromptTokens,
			"completion_tokens": outcome.Usage.CompletionTokens,
			"total_tokens":      outcome.Usage.TotalTokens,
		},
	})
	pub.emit(map[string]interface{}{"type": consts.EventStreamEnd})
	go maybeFlushMemory(context.Background(), sessionID)
}

// runAgentLoop builds the context, calls the model and executes any tool calls
// until the model produces a final answer.
func runAgentLoop(ctx context.Context, sessionID string, session *Session, pub publisher) (*agentOutcome, error) {
	dbCtx := context.Background()

	turns := config.C().GetInt(consts.CfgAgentMaxContextTurns, 30)
	limit := turns * 2
	if limit < 2 {
		limit = 2
	}
	history, err := RecentMessages(dbCtx, sessionID, limit)
	if err != nil {
		return nil, err
	}

	model := config.C().GetString(consts.CfgModel)
	providerID := config.C().GetString(consts.CfgBotType)
	if session != nil && session.ModelName != "" {
		model = session.ModelName
		providerID = session.ModelProvider
	}
	resolved, err := config.Resolve(model, providerID)
	if err != nil {
		return nil, fmt.Errorf("%w: %s", ErrNoAPIKey, err.Error())
	}

	messages := buildMessages(history)
	registry := enabledTools()
	defs := toToolDefinitions(registry.Definitions())
	execCtx := tools.ExecContext{
		WorkDir:    workDir(),
		SessionID:  sessionID,
		Permission: config.C().GetString(consts.CfgAgentPermissionMode),
	}

	onDelta := func(delta string) error {
		pub.emit(map[string]interface{}{"type": consts.EventDelta, "content": delta})
		return nil
	}
	onReasoning := func(reasoning string) error {
		pub.emit(map[string]interface{}{"type": consts.EventReasoning, "content": reasoning})
		return nil
	}

	maxSteps := config.C().GetInt(consts.CfgAgentMaxSteps, 30)
	if maxSteps < 1 {
		maxSteps = 1
	}

	var generatedMedia []tools.Media
	for step := 0; step < maxSteps; step++ {
		opts := sampleOptions()
		opts.Tools = defs

		result, err := llm.ChatStream(ctx, resolved, messages, opts, onDelta, onReasoning)
		if err != nil {
			return nil, err
		}

		if len(result.ToolCalls) == 0 {
			// Remove any workspace-image markdown the model copied from earlier
			// turns, then append exactly the images generated this turn. The
			// reply therefore only ever shows the current result.
			content := stripWorkspaceImages(result.Content)
			var links []string
			for _, m := range generatedMedia {
				if m.Type != consts.MediaTypeImage || m.URL == "" {
					continue
				}
				links = append(links, fmt.Sprintf("![image](%s)", m.URL))
			}
			if len(links) > 0 {
				content = strings.TrimRight(content, "\n") + "\n\n" + strings.Join(links, "\n")
			}
			if _, err := AppendMessage(dbCtx, sessionID, consts.RoleAssistant, content, ""); err != nil {
				return nil, err
			}
			return &agentOutcome{Content: content, Model: resolved.Model, Usage: result.Usage}, nil
		}

		messages = append(messages, llm.Message{Role: consts.RoleAssistant, ToolCalls: result.ToolCalls})
		for _, call := range result.ToolCalls {
			name := call.Function.Name
			var args interface{} = call.Function.Arguments
			if parsed := map[string]interface{}{}; json.Unmarshal([]byte(call.Function.Arguments), &parsed) == nil {
				args = parsed
			}
			pub.emit(map[string]interface{}{
				"type":         consts.EventToolStart,
				"tool_call_id": call.ID,
				"name":         name,
				"args":         args,
				"content":      name,
			})

			res, execErr := registry.ExecuteFull(ctx, name, call.Function.Arguments, execCtx)
			out := res.Output
			status := consts.ToolStatusDone
			if execErr != nil {
				status = consts.ToolStatusError
				if strings.TrimSpace(out) == "" {
					out = execErr.Error()
				} else {
					out = out + "\n" + execErr.Error()
				}
			}
			if strings.TrimSpace(out) == "" {
				out = "(no output)"
			}
			pub.emit(map[string]interface{}{
				"type":         consts.EventToolEnd,
				"tool_call_id": call.ID,
				"name":         name,
				"result":       out,
				"status":       status,
			})
			if len(res.Media) > 0 {
				pub.emit(map[string]interface{}{
					"type":         consts.EventToolMedia,
					"tool_call_id": call.ID,
					"media":        mediaPayload(res.Media),
				})
				generatedMedia = append(generatedMedia, res.Media...)
			}
			messages = append(messages, llm.ToolResultMessage(call.ID, out))
		}
	}

	return nil, fmt.Errorf("reached the %d step limit without a final answer", maxSteps)
}

// mediaPayload serialises generated media for the tool_media SSE event.
func mediaPayload(media []tools.Media) []map[string]interface{} {
	out := make([]map[string]interface{}, 0, len(media))
	for _, m := range media {
		out = append(out, map[string]interface{}{
			"path": m.Path,
			"type": m.Type,
			"mime": m.MIME,
			"url":  m.URL,
		})
	}
	return out
}

var (
	imageMdRe  = regexp.MustCompile(`!\[[^\]]*\]\(([^)]*)\)`)
	imageExtRe = regexp.MustCompile(`(?i)\.(png|jpe?g|gif|webp|bmp|svg)(\?.*)?$`)
)

// isWorkspaceMediaURL reports whether a markdown image target points at a
// generated/local workspace image (as opposed to an external http(s) image).
func isWorkspaceMediaURL(raw string) bool {
	u := strings.TrimSpace(raw)
	if i := strings.IndexAny(u, " \t"); i >= 0 {
		u = u[:i]
	}
	u = strings.Trim(u, "<>")
	if u == "" {
		return false
	}
	low := strings.ToLower(u)
	if strings.HasPrefix(low, "http://") || strings.HasPrefix(low, "https://") ||
		strings.HasPrefix(low, "data:") || strings.HasPrefix(low, "#") {
		return false
	}
	if strings.Contains(low, "/api/media") {
		return true
	}
	return imageExtRe.MatchString(low)
}

// stripWorkspaceImages removes markdown images referencing generated/local
// workspace files (external images are kept). It stops the model from
// re-emitting images produced in earlier turns.
func stripWorkspaceImages(s string) string {
	if !strings.Contains(s, "](") {
		return s
	}
	return imageMdRe.ReplaceAllStringFunc(s, func(m string) string {
		if sub := imageMdRe.FindStringSubmatch(m); len(sub) >= 2 && isWorkspaceMediaURL(sub[1]) {
			return ""
		}
		return m
	})
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

func enabledTools() *tools.Registry {
	var disabled []string
	if list, ok := config.C().Get(consts.CfgDisabledTools).([]interface{}); ok {
		for _, item := range list {
			if name, ok := item.(string); ok && name != "" {
				disabled = append(disabled, name)
			}
		}
	}
	return tools.Filtered(disabled)
}

func toToolDefinitions(defs []tools.Definition) []llm.ToolDefinition {
	out := make([]llm.ToolDefinition, 0, len(defs))
	for _, d := range defs {
		out = append(out, llm.ToolDefinition{
			Type: consts.ToolTypeFunction,
			Function: llm.ToolFunction{
				Name:        d.Name,
				Description: d.Description,
				Parameters:  d.Parameters,
			},
		})
	}
	return out
}

func workDir() string {
	return paths.Workspace()
}

func buildMessages(history []Message) []llm.Message {
	out := make([]llm.Message, 0, len(history)+1)
	system := strings.TrimSpace(config.C().GetString(consts.CfgCharacterDesc))
	if mem := memoryContext(); mem != "" {
		if system != "" {
			system += "\n\n"
		}
		system += "# Long-term memory (MEMORY.md)\n" + mem
	}
	if system != "" {
		out = append(out, llm.TextMessage(consts.RoleSystem, system))
	}
	for _, m := range history {
		role := m.Role
		if role != consts.RoleUser && role != consts.RoleAssistant && role != consts.RoleSystem {
			role = consts.RoleUser
		}
		// Drop workspace-image markdown from history so the model can never
		// copy an image link from an earlier turn.
		out = append(out, llm.TextMessage(role, stripWorkspaceImages(m.Content)))
	}
	return out
}

// memoryContext returns MEMORY.md (capped) for injection into the system prompt.
func memoryContext() string {
	content, err := memory.ReadFile("MEMORY.md")
	if err != nil {
		return ""
	}
	content = strings.TrimSpace(content)
	const maxChars = 8000
	if len(content) > maxChars {
		content = content[:maxChars]
	}
	return content
}

func sampleOptions() llm.Options {
	s := config.C()
	return llm.Options{
		Temperature: floatPtr(s.Get(consts.CfgTemperature)),
		TopP:        floatPtr(s.Get(consts.CfgTopP)),
		Timeout:     time.Duration(s.GetInt(consts.CfgRequestTimeout, 180)) * time.Second,
		Proxy:       s.GetString(consts.CfgProxy),
	}
}

func floatPtr(v interface{}) *float64 {
	switch t := v.(type) {
	case float64:
		return &t
	case int:
		f := float64(t)
		return &f
	case int64:
		f := float64(t)
		return &f
	default:
		return nil
	}
}

func isClearCommand(message string) bool {
	if message == consts.CommandClear {
		return true
	}
	list, ok := config.C().Get(consts.CfgClearMemoryCommands).([]interface{})
	if !ok {
		return false
	}
	for _, item := range list {
		if cmd, ok := item.(string); ok && cmd != "" && message == cmd {
			return true
		}
	}
	return false
}

func makeTitle(message string) string {
	message = strings.TrimSpace(message)
	if message == "" {
		return ""
	}
	runes := []rune(message)
	if len(runes) > 30 {
		return string(runes[:30])
	}
	return message
}

func attachmentRefs(atts []Attachment) string {
	if len(atts) == 0 {
		return ""
	}
	parts := make([]string, 0, len(atts))
	for _, a := range atts {
		if a.FilePath == "" {
			continue
		}
		kind := a.FileType
		if kind == "" {
			kind = consts.AttachmentKindFile
		}
		parts = append(parts, fmt.Sprintf("[%s: %s]", kind, a.FilePath))
	}
	return strings.Join(parts, "\n")
}

// ---------------------------------------------------------------------------
// long-term memory
// ---------------------------------------------------------------------------

var (
	flushMu     sync.Mutex
	flushedUpTo = map[string]int64{}
)

// handleMemoryCommand handles the /memory slash command.
func handleMemoryCommand(ctx context.Context, message string) *SendResult {
	parts := strings.Fields(strings.TrimSpace(message))
	sub := ""
	if len(parts) > 1 {
		sub = strings.ToLower(parts[1])
	}
	switch sub {
	case "rebuild-index", "rebuild":
		memory.MarkDirty()
		if _, err := memory.Sync(ctx); err != nil {
			return &SendResult{InlineReply: "记忆索引重建失败: " + err.Error()}
		}
		return &SendResult{InlineReply: "记忆索引已重建"}
	case "flush":
		summary, err := summarizeSession(ctx, "", config.C().GetInt(consts.CfgMemoryFlushTurns, 10))
		if err != nil {
			return &SendResult{InlineReply: "记忆总结失败: " + err.Error()}
		}
		if strings.TrimSpace(summary) == "" {
			return &SendResult{InlineReply: "没有可总结的内容"}
		}
		if err := memory.AppendDaily(summary); err != nil {
			return &SendResult{InlineReply: "写入每日记忆失败: " + err.Error()}
		}
		return &SendResult{InlineReply: "已写入今日记忆"}
	default:
		return &SendResult{InlineReply: "记忆命令：/memory rebuild-index（重建索引）、/memory flush（总结当前会话到今日记忆）"}
	}
}

// maybeFlushMemory summarizes a session into daily memory once enough turns have
// accumulated.
func maybeFlushMemory(ctx context.Context, sessionID string) {
	if !config.C().GetBool(consts.CfgMemoryAutoFlush) {
		return
	}
	threshold := config.C().GetInt(consts.CfgMemoryFlushTurns, 10)
	if threshold <= 0 {
		return
	}
	total, err := MessageCount(ctx, sessionID)
	if err != nil {
		return
	}
	flushMu.Lock()
	last := flushedUpTo[sessionID]
	if total-last < int64(threshold*2) {
		flushMu.Unlock()
		return
	}
	flushedUpTo[sessionID] = total
	flushMu.Unlock()

	summary, err := summarizeSession(ctx, sessionID, threshold)
	if err != nil || strings.TrimSpace(summary) == "" {
		return
	}
	if err := memory.AppendDaily(summary); err == nil {
		memory.MarkDirty()
	}
}

// summarizeSession asks the model to distill recent messages into memory bullets.
func summarizeSession(ctx context.Context, sessionID string, turns int) (string, error) {
	if turns <= 0 {
		turns = 10
	}
	history, err := RecentMessages(ctx, sessionID, turns*2)
	if err != nil {
		return "", err
	}
	if len(history) == 0 {
		return "", nil
	}

	resolved, err := config.Resolve(config.C().GetString(consts.CfgModel), config.C().GetString(consts.CfgBotType))
	if err != nil {
		return "", err
	}

	var b strings.Builder
	for _, m := range history {
		fmt.Fprintf(&b, "%s: %s\n", m.Role, m.Content)
	}

	system := "You distill durable long-term memory from a conversation. " +
		"Summarize ONLY what is worth remembering: the user's preferences, stable facts, decisions and open tasks. " +
		"Output 1-5 concise Markdown bullet points, no preamble. Omit small talk."
	opts := sampleOptions()
	opts.Timeout = 60 * time.Second
	return llm.Complete(ctx, resolved, []llm.Message{
		llm.TextMessage(consts.RoleSystem, system),
		llm.TextMessage(consts.RoleUser, b.String()),
	}, opts)
}
