package tools

import (
	"context"
	"fmt"
	"strings"

	"GopherAgent/internal/consts"
	"GopherAgent/internal/logic/memory"
)

// MemorySearchTool searches the long-term memory index (hybrid vector + keyword).
type MemorySearchTool struct{}

func (MemorySearchTool) Name() string { return consts.ToolMemorySearch }

func (MemorySearchTool) Description() string {
	return "Search the agent's long-term memory and knowledge using hybrid retrieval " +
		"(semantic vector + keyword). Use it to recall the user's preferences, past " +
		"decisions and stored knowledge."
}

func (MemorySearchTool) Parameters() map[string]interface{} {
	return map[string]interface{}{
		"type": "object",
		"properties": map[string]interface{}{
			"query":       map[string]interface{}{"type": "string", "description": "Natural-language question or keywords."},
			"max_results": map[string]interface{}{"type": "integer", "description": "Maximum number of results (default 10, max 50)."},
			"min_score":   map[string]interface{}{"type": "number", "description": "Minimum relevance score 0-1 (default 0.1)."},
		},
		"required": []string{"query"},
	}
}

func (MemorySearchTool) Execute(ctx context.Context, args map[string]interface{}, ec ExecContext) (string, error) {
	query := strings.TrimSpace(strArg(args, "query"))
	if query == "" {
		return "", fmt.Errorf("query is required")
	}
	results, err := memory.Search(ctx, query, memory.SearchOptions{
		MaxResults: intArg(args, "max_results", 0),
		MinScore:   floatArg(args, "min_score", 0),
	})
	if err != nil {
		return "", err
	}
	if len(results) == 0 {
		return fmt.Sprintf("No memories found for %q. Memories are stored in MEMORY.md and memory/YYYY-MM-DD.md.", query), nil
	}

	var b strings.Builder
	fmt.Fprintf(&b, "Found %d memories for %q:\n", len(results), query)
	for i, r := range results {
		fmt.Fprintf(&b, "\n%d. %s (lines %d-%d, score %.3f)\n   %s",
			i+1, r.Path, r.StartLine, r.EndLine, r.Score, r.Snippet)
	}
	return b.String(), nil
}

// MemoryGetTool reads a range of lines from a memory file.
type MemoryGetTool struct{}

func (MemoryGetTool) Name() string { return consts.ToolMemoryGet }

func (MemoryGetTool) Description() string {
	return "Read the content of a long-term memory or knowledge file, optionally a line range. " +
		"Use it after memory_search to recover full context."
}

func (MemoryGetTool) Parameters() map[string]interface{} {
	return map[string]interface{}{
		"type": "object",
		"properties": map[string]interface{}{
			"path":       map[string]interface{}{"type": "string", "description": "Relative path, e.g. MEMORY.md or 2026-10-04.md."},
			"start_line": map[string]interface{}{"type": "integer", "description": "1-based start line (default 1)."},
			"num_lines":  map[string]interface{}{"type": "integer", "description": "Number of lines to read (default: to end of file)."},
		},
		"required": []string{"path"},
	}
}

func (MemoryGetTool) Execute(ctx context.Context, args map[string]interface{}, ec ExecContext) (string, error) {
	path := strings.TrimSpace(strArg(args, "path"))
	if path == "" {
		return "", fmt.Errorf("path is required")
	}
	return memory.GetLines(path, intArg(args, "start_line", 1), intArg(args, "num_lines", 0))
}
