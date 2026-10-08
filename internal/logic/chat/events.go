package chat

// StreamEvent is one SSE payload sent to the console. Every field beyond Type
// is omitted when empty, so the wire shape is identical to the per-event maps
// this replaced. Seq is the server's monotonic sequence number for the request.
type StreamEvent struct {
	Type       string        `json:"type"`
	Seq        int           `json:"seq,omitempty"`
	Content    string        `json:"content,omitempty"`
	Name       string        `json:"name,omitempty"`
	ToolCallID string        `json:"tool_call_id,omitempty"`
	Args       interface{}   `json:"args,omitempty"`
	Result     string        `json:"result,omitempty"`
	Status     string        `json:"status,omitempty"`
	Message    string        `json:"message,omitempty"`
	SessionID  string        `json:"session_id,omitempty"`
	Model      string        `json:"model,omitempty"`
	Usage      *TokenUsage   `json:"usage,omitempty"`
	Media      []StreamMedia `json:"media,omitempty"`
}

// TokenUsage is the provider usage block carried by the done event.
type TokenUsage struct {
	PromptTokens     int `json:"prompt_tokens"`
	CompletionTokens int `json:"completion_tokens"`
	TotalTokens      int `json:"total_tokens"`
}

// StreamMedia is one generated-media entry on a tool_media event.
type StreamMedia struct {
	Path string `json:"path"`
	Type string `json:"type"`
	MIME string `json:"mime"`
	URL  string `json:"url"`
}
