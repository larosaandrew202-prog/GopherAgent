// Package llm provides a minimal OpenAI-compatible chat client with streaming
// and function (tool) calling support.
package llm

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"GopherAgent/internal/consts"
	"GopherAgent/internal/logic/config"
)

// Message is a single chat message in OpenAI format.
type Message struct {
	Role       string     `json:"role"`
	Content    *string    `json:"content"`
	ToolCalls  []ToolCall `json:"tool_calls,omitempty"`
	ToolCallID string     `json:"tool_call_id,omitempty"`
}

// TextMessage builds a plain text message.
func TextMessage(role, content string) Message {
	c := content
	return Message{Role: role, Content: &c}
}

// ToolResultMessage builds a tool result message.
func ToolResultMessage(toolCallID, content string) Message {
	c := content
	return Message{Role: consts.RoleTool, ToolCallID: toolCallID, Content: &c}
}

// ToolCall is a function call requested by the model.
type ToolCall struct {
	ID       string           `json:"id"`
	Type     string           `json:"type"`
	Function ToolCallFunction `json:"function"`
}

// ToolCallFunction carries the tool name and JSON arguments.
type ToolCallFunction struct {
	Name      string `json:"name"`
	Arguments string `json:"arguments"`
}

// ToolDefinition advertises a callable tool to the model.
type ToolDefinition struct {
	Type     string       `json:"type"`
	Function ToolFunction `json:"function"`
}

// ToolFunction describes a tool's name, description and JSON schema.
type ToolFunction struct {
	Name        string                 `json:"name"`
	Description string                 `json:"description"`
	Parameters  map[string]interface{} `json:"parameters"`
}

// Usage carries token accounting returned by the provider.
type Usage struct {
	PromptTokens     int `json:"prompt_tokens"`
	CompletionTokens int `json:"completion_tokens"`
	TotalTokens      int `json:"total_tokens"`
}

// Options tunes a single chat request.
type Options struct {
	Temperature *float64
	TopP        *float64
	MaxTokens   int
	Timeout     time.Duration
	Proxy       string
	Tools       []ToolDefinition
}

// Result is the outcome of a chat request.
type Result struct {
	Content      string
	ToolCalls    []ToolCall
	FinishReason string
	Model        string
	Usage        Usage
}

type chatRequest struct {
	Model       string           `json:"model"`
	Messages    []Message        `json:"messages"`
	Stream      bool             `json:"stream"`
	Temperature *float64         `json:"temperature,omitempty"`
	TopP        *float64         `json:"top_p,omitempty"`
	MaxTokens   int              `json:"max_tokens,omitempty"`
	Tools       []ToolDefinition `json:"tools,omitempty"`
	ToolChoice  string           `json:"tool_choice,omitempty"`
}

type streamDelta struct {
	Content          string `json:"content"`
	ReasoningContent string `json:"reasoning_content"`
	ToolCalls        []struct {
		Index    int    `json:"index"`
		ID       string `json:"id"`
		Type     string `json:"type"`
		Function struct {
			Name      string `json:"name"`
			Arguments string `json:"arguments"`
		} `json:"function"`
	} `json:"tool_calls"`
}

type streamChunk struct {
	Choices []struct {
		Delta        streamDelta `json:"delta"`
		FinishReason string      `json:"finish_reason"`
	} `json:"choices"`
	Usage *Usage `json:"usage"`
	Error *struct {
		Message string `json:"message"`
	} `json:"error"`
}

func buildClient(opts Options) *http.Client {
	timeout := opts.Timeout
	if timeout <= 0 {
		timeout = 180 * time.Second
	}
	transport := &http.Transport{
		MaxIdleConns:        100,
		MaxIdleConnsPerHost: 10,
		IdleConnTimeout:     90 * time.Second,
	}
	if opts.Proxy != "" {
		if u, err := url.Parse(opts.Proxy); err == nil {
			transport.Proxy = http.ProxyURL(u)
		}
	} else {
		transport.Proxy = http.ProxyFromEnvironment
	}
	return &http.Client{Transport: transport, Timeout: timeout}
}

func buildRequest(ctx context.Context, r *config.Resolved, messages []Message, opts Options, stream bool) (*http.Request, error) {
	body := chatRequest{Model: r.Model, Messages: messages, Stream: stream}
	body.Temperature = opts.Temperature
	body.TopP = opts.TopP
	body.MaxTokens = opts.MaxTokens
	if len(opts.Tools) > 0 {
		body.Tools = opts.Tools
		body.ToolChoice = consts.ToolChoiceAuto
	}

	payload, err := json.Marshal(body)
	if err != nil {
		return nil, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, r.APIBase+"/chat/completions", bytes.NewReader(payload))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+r.APIKey)
	req.Header.Set("Accept", "application/json")
	return req, nil
}

func readError(resp *http.Response) error {
	raw, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	var envelope struct {
		Error *struct {
			Message string `json:"message"`
		} `json:"error"`
	}
	if err := json.Unmarshal(raw, &envelope); err == nil && envelope.Error != nil && envelope.Error.Message != "" {
		return fmt.Errorf("HTTP %d: %s", resp.StatusCode, envelope.Error.Message)
	}
	text := strings.TrimSpace(string(raw))
	if len(text) > 500 {
		text = text[:500]
	}
	if text == "" {
		text = http.StatusText(resp.StatusCode)
	}
	return fmt.Errorf("HTTP %d: %s", resp.StatusCode, text)
}

// ChatStream performs a streaming chat completion, invoking onDelta for each
// content fragment and onReasoning for each reasoning fragment. Either callback
// may be nil. Tool calls are accumulated and returned in the result.
func ChatStream(ctx context.Context, r *config.Resolved, messages []Message, opts Options, onDelta, onReasoning func(string) error) (*Result, error) {
	req, err := buildRequest(ctx, r, messages, opts, true)
	if err != nil {
		return nil, err
	}
	client := buildClient(opts)
	// The http.Client.Timeout would abort long-lived streams; rely on the
	// request context for cancellation instead.
	client.Timeout = 0
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		return nil, readError(resp)
	}

	type acc struct {
		id   string
		name string
		args strings.Builder
	}
	accs := map[int]*acc{}

	var (
		builder strings.Builder
		usage   Usage
		model   = r.Model
		finish  string
	)

	scanner := bufio.NewScanner(resp.Body)
	scanner.Buffer(make([]byte, 0, 64*1024), 4*1024*1024)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || !strings.HasPrefix(line, "data:") {
			continue
		}
		data := strings.TrimSpace(strings.TrimPrefix(line, "data:"))
		if data == "[DONE]" {
			break
		}
		var chunk streamChunk
		if err := json.Unmarshal([]byte(data), &chunk); err != nil {
			continue
		}
		if chunk.Error != nil && chunk.Error.Message != "" {
			return nil, fmt.Errorf("%s", chunk.Error.Message)
		}
		if chunk.Usage != nil {
			usage = *chunk.Usage
		}
		if len(chunk.Choices) == 0 {
			continue
		}
		choice := chunk.Choices[0]
		if choice.FinishReason != "" {
			finish = choice.FinishReason
		}
		if choice.Delta.ReasoningContent != "" && onReasoning != nil {
			if err := onReasoning(choice.Delta.ReasoningContent); err != nil {
				return nil, err
			}
		}
		if choice.Delta.Content != "" {
			builder.WriteString(choice.Delta.Content)
			if onDelta != nil {
				if err := onDelta(choice.Delta.Content); err != nil {
					return nil, err
				}
			}
		}
		for _, tc := range choice.Delta.ToolCalls {
			entry, ok := accs[tc.Index]
			if !ok {
				entry = &acc{}
				accs[tc.Index] = entry
			}
			if tc.ID != "" {
				entry.id = tc.ID
			}
			if tc.Function.Name != "" {
				entry.name = tc.Function.Name
			}
			entry.args.WriteString(tc.Function.Arguments)
		}
	}
	if err := scanner.Err(); err != nil {
		return nil, fmt.Errorf("stream read: %w", err)
	}

	result := &Result{
		Content:      builder.String(),
		FinishReason: finish,
		Model:        model,
		Usage:        usage,
	}
	// Assemble tool calls in index order.
	for i := 0; i < len(accs); i++ {
		entry, ok := accs[i]
		if !ok {
			continue
		}
		result.ToolCalls = append(result.ToolCalls, ToolCall{
			ID:   entry.id,
			Type: consts.ToolTypeFunction,
			Function: ToolCallFunction{
				Name:      entry.name,
				Arguments: entry.args.String(),
			},
		})
	}
	return result, nil
}

// Complete performs a non-streaming chat completion and returns the text. It is
// used for background summarization (e.g. memory flush).
func Complete(ctx context.Context, r *config.Resolved, messages []Message, opts Options) (string, error) {
	req, err := buildRequest(ctx, r, messages, opts, false)
	if err != nil {
		return "", err
	}
	resp, err := buildClient(opts).Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		return "", readError(resp)
	}
	var out struct {
		Choices []struct {
			Message struct {
				Content string `json:"content"`
			} `json:"message"`
		} `json:"choices"`
		Error *struct {
			Message string `json:"message"`
		} `json:"error"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return "", fmt.Errorf("decode response: %w", err)
	}
	if out.Error != nil && out.Error.Message != "" {
		return "", fmt.Errorf("%s", out.Error.Message)
	}
	if len(out.Choices) == 0 {
		return "", nil
	}
	return out.Choices[0].Message.Content, nil
}
