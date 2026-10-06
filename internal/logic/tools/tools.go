// Package tools implements the local capabilities the agent can invoke
// (shell, file I/O, web fetch). Tools are described with JSON Schema so they
// can be advertised to any OpenAI-compatible model via function calling.
package tools

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"sync"
)

// Definition describes a tool to the model.
type Definition struct {
	Name        string
	Description string
	Parameters  map[string]interface{}
}

// ExecContext carries request-scoped information for tool execution.
type ExecContext struct {
	// WorkDir resolves relative paths and is the shell's working directory.
	WorkDir string
	// SessionID is the conversation that triggered the tool.
	SessionID string
	// Permission is the active permission mode (read_only / workspace_write /
	// full_access). Reserved for future enforcement.
	Permission string
}

// Tool is a capability the agent can call.
type Tool interface {
	Name() string
	Description() string
	Parameters() map[string]interface{}
	Execute(ctx context.Context, args map[string]interface{}, ec ExecContext) (string, error)
}

// Registry holds the available tools.
type Registry struct {
	mu    sync.RWMutex
	tools map[string]Tool
	order []string
}

// NewRegistry returns an empty registry.
func NewRegistry() *Registry {
	return &Registry{tools: make(map[string]Tool)}
}

// Register adds (or replaces) a tool.
func (r *Registry) Register(t Tool) {
	r.mu.Lock()
	defer r.mu.Unlock()
	name := t.Name()
	if _, exists := r.tools[name]; !exists {
		r.order = append(r.order, name)
	}
	r.tools[name] = t
}

// Get returns a tool by name.
func (r *Registry) Get(name string) (Tool, bool) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	t, ok := r.tools[name]
	return t, ok
}

// Definitions returns the tool catalogue in registration order.
func (r *Registry) Definitions() []Definition {
	r.mu.RLock()
	defer r.mu.RUnlock()
	out := make([]Definition, 0, len(r.order))
	for _, name := range r.order {
		t := r.tools[name]
		out = append(out, Definition{
			Name:        t.Name(),
			Description: t.Description(),
			Parameters:  t.Parameters(),
		})
	}
	return out
}

// Execute parses the JSON arguments and runs the named tool.
func (r *Registry) Execute(ctx context.Context, name, argsJSON string, ec ExecContext) (string, error) {
	tool, ok := r.Get(name)
	if !ok {
		return "", fmt.Errorf("unknown tool: %s", name)
	}
	args := map[string]interface{}{}
	if strings.TrimSpace(argsJSON) != "" {
		if err := json.Unmarshal([]byte(argsJSON), &args); err != nil {
			return "", fmt.Errorf("invalid arguments for %s: %w", name, err)
		}
	}
	out, err := tool.Execute(ctx, args, ec)
	if err != nil {
		return out, err
	}
	return truncate(out, maxToolOutput), nil
}

// Media describes a generated artifact a tool wants surfaced to the console.
type Media struct {
	Path string // workspace-relative path
	Type string // consts.MediaTypeImage / MediaTypeVideo
	MIME string
	URL  string
}

// RichResult is a tool result that may carry media alongside its text output.
type RichResult struct {
	Output string
	Media  []Media
}

// RichTool is implemented by tools that produce structured media (e.g. images).
type RichTool interface {
	Tool
	ExecuteRich(ctx context.Context, args map[string]interface{}, ec ExecContext) (RichResult, error)
}

// ExecuteFull runs a tool, returning structured media when the tool supports it
// and otherwise falling back to the plain string result.
func (r *Registry) ExecuteFull(ctx context.Context, name, argsJSON string, ec ExecContext) (RichResult, error) {
	tool, ok := r.Get(name)
	if !ok {
		return RichResult{}, fmt.Errorf("unknown tool: %s", name)
	}
	args := map[string]interface{}{}
	if strings.TrimSpace(argsJSON) != "" {
		if err := json.Unmarshal([]byte(argsJSON), &args); err != nil {
			return RichResult{}, fmt.Errorf("invalid arguments for %s: %w", name, err)
		}
	}
	if rt, ok := tool.(RichTool); ok {
		res, err := rt.ExecuteRich(ctx, args, ec)
		res.Output = truncate(res.Output, maxToolOutput)
		return res, err
	}
	out, err := tool.Execute(ctx, args, ec)
	return RichResult{Output: truncate(out, maxToolOutput)}, err
}

const maxToolOutput = 20000

func truncate(s string, limit int) string {
	if len(s) <= limit {
		return s
	}
	return s[:limit] + fmt.Sprintf("\n... [truncated, %d bytes total]", len(s))
}

// ---------------------------------------------------------------------------
// argument helpers
// ---------------------------------------------------------------------------

func strArg(args map[string]interface{}, key string) string {
	if v, ok := args[key]; ok {
		if s, ok := v.(string); ok {
			return s
		}
	}
	return ""
}

func intArg(args map[string]interface{}, key string, def int) int {
	switch v := args[key].(type) {
	case float64:
		return int(v)
	case int:
		return v
	case int64:
		return int(v)
	case json.Number:
		if n, err := v.Int64(); err == nil {
			return int(n)
		}
	}
	return def
}

func boolArg(args map[string]interface{}, key string) bool {
	switch v := args[key].(type) {
	case bool:
		return v
	case string:
		return strings.EqualFold(v, "true")
	}
	return false
}

func floatArg(args map[string]interface{}, key string, def float64) float64 {
	switch v := args[key].(type) {
	case float64:
		return v
	case int:
		return float64(v)
	case int64:
		return float64(v)
	case json.Number:
		if f, err := v.Float64(); err == nil {
			return f
		}
	case string:
		var f float64
		if _, err := fmt.Sscanf(v, "%g", &f); err == nil {
			return f
		}
	}
	return def
}
