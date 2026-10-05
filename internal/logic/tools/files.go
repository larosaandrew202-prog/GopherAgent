package tools

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"GopherAgent/internal/consts"
)

const maxReadBytes = 40000

// resolvePath resolves a possibly-relative path against the working directory.
func resolvePath(ec ExecContext, path string) string {
	path = strings.TrimSpace(path)
	if path == "" || path == "." {
		if ec.WorkDir != "" {
			return ec.WorkDir
		}
		if wd, err := os.Getwd(); err == nil {
			return wd
		}
		return "."
	}
	if filepath.IsAbs(path) {
		return filepath.Clean(path)
	}
	base := ec.WorkDir
	if base == "" {
		if wd, err := os.Getwd(); err == nil {
			base = wd
		}
	}
	return filepath.Join(base, path)
}

// ReadTool reads a file from disk.
type ReadTool struct{}

func (ReadTool) Name() string { return consts.ToolRead }

func (ReadTool) Description() string {
	return "Read a UTF-8 text file. Supports an optional 1-based line offset and a line limit."
}

func (ReadTool) Parameters() map[string]interface{} {
	return map[string]interface{}{
		"type": "object",
		"properties": map[string]interface{}{
			"path":   map[string]interface{}{"type": "string", "description": "File path (absolute or relative to the working directory)."},
			"offset": map[string]interface{}{"type": "integer", "description": "1-based line to start from."},
			"limit":  map[string]interface{}{"type": "integer", "description": "Maximum number of lines to return."},
		},
		"required": []string{"path"},
	}
}

func (ReadTool) Execute(ctx context.Context, args map[string]interface{}, ec ExecContext) (string, error) {
	path := resolvePath(ec, strArg(args, "path"))
	data, err := os.ReadFile(path)
	if err != nil {
		return "", err
	}
	if len(data) > maxReadBytes {
		data = data[:maxReadBytes]
	}
	lines := strings.Split(string(data), "\n")

	offset := intArg(args, "offset", 1)
	if offset < 1 {
		offset = 1
	}
	limit := intArg(args, "limit", 0)
	if offset > len(lines) {
		return "", fmt.Errorf("offset %d is past end of file (%d lines)", offset, len(lines))
	}
	end := len(lines)
	if limit > 0 && offset-1+limit < end {
		end = offset - 1 + limit
	}

	var b strings.Builder
	for i := offset - 1; i < end; i++ {
		fmt.Fprintf(&b, "%6d\t%s\n", i+1, lines[i])
	}
	return b.String(), nil
}

// WriteTool creates or overwrites a file.
type WriteTool struct{}

func (WriteTool) Name() string { return consts.ToolWrite }

func (WriteTool) Description() string {
	return "Create or overwrite a file with the given content, creating parent directories as needed."
}

func (WriteTool) Parameters() map[string]interface{} {
	return map[string]interface{}{
		"type": "object",
		"properties": map[string]interface{}{
			"path":    map[string]interface{}{"type": "string", "description": "File path to write."},
			"content": map[string]interface{}{"type": "string", "description": "Full file content."},
		},
		"required": []string{"path", "content"},
	}
}

func (WriteTool) Execute(ctx context.Context, args map[string]interface{}, ec ExecContext) (string, error) {
	path := resolvePath(ec, strArg(args, "path"))
	content := strArg(args, "content")
	if path == "" {
		return "", errors.New("path is required")
	}
	if dir := filepath.Dir(path); dir != "" {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			return "", err
		}
	}
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		return "", err
	}
	return fmt.Sprintf("wrote %d bytes to %s", len(content), path), nil
}

// EditTool replaces text in an existing file.
type EditTool struct{}

func (EditTool) Name() string { return consts.ToolEdit }

func (EditTool) Description() string {
	return "Replace an exact string in a file. By default the old string must be unique; set replace_all to replace every occurrence."
}

func (EditTool) Parameters() map[string]interface{} {
	return map[string]interface{}{
		"type": "object",
		"properties": map[string]interface{}{
			"path":        map[string]interface{}{"type": "string", "description": "File path to edit."},
			"old_string":  map[string]interface{}{"type": "string", "description": "Exact text to replace."},
			"new_string":  map[string]interface{}{"type": "string", "description": "Replacement text."},
			"replace_all": map[string]interface{}{"type": "boolean", "description": "Replace every occurrence instead of requiring a unique match."},
		},
		"required": []string{"path", "old_string", "new_string"},
	}
}

func (EditTool) Execute(ctx context.Context, args map[string]interface{}, ec ExecContext) (string, error) {
	path := resolvePath(ec, strArg(args, "path"))
	oldStr := strArg(args, "old_string")
	newStr := strArg(args, "new_string")
	if oldStr == "" {
		return "", errors.New("old_string is required")
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return "", err
	}
	content := string(data)
	count := strings.Count(content, oldStr)
	if count == 0 {
		return "", fmt.Errorf("old_string not found in %s", path)
	}
	replaceAll := boolArg(args, "replace_all")
	if count > 1 && !replaceAll {
		return "", fmt.Errorf("old_string appears %d times; provide more context or set replace_all", count)
	}
	if replaceAll {
		content = strings.ReplaceAll(content, oldStr, newStr)
	} else {
		content = strings.Replace(content, oldStr, newStr, 1)
	}
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		return "", err
	}
	return fmt.Sprintf("edited %s (%d replacement(s))", path, count), nil
}

// LsTool lists a directory.
type LsTool struct{}

func (LsTool) Name() string { return consts.ToolLs }

func (LsTool) Description() string {
	return "List the entries of a directory with their type and size."
}

func (LsTool) Parameters() map[string]interface{} {
	return map[string]interface{}{
		"type": "object",
		"properties": map[string]interface{}{
			"path": map[string]interface{}{"type": "string", "description": "Directory path (defaults to the working directory)."},
		},
	}
}

func (LsTool) Execute(ctx context.Context, args map[string]interface{}, ec ExecContext) (string, error) {
	path := resolvePath(ec, strArg(args, "path"))
	entries, err := os.ReadDir(path)
	if err != nil {
		return "", err
	}
	sort.Slice(entries, func(i, j int) bool {
		if entries[i].IsDir() != entries[j].IsDir() {
			return entries[i].IsDir()
		}
		return entries[i].Name() < entries[j].Name()
	})
	var b strings.Builder
	for i, e := range entries {
		if i >= 300 {
			fmt.Fprintf(&b, "... [%d more entries]\n", len(entries)-i)
			break
		}
		if e.IsDir() {
			fmt.Fprintf(&b, "dir  %s/\n", e.Name())
			continue
		}
		info, err := e.Info()
		size := int64(0)
		if err == nil {
			size = info.Size()
		}
		fmt.Fprintf(&b, "file %8d  %s\n", size, e.Name())
	}
	if b.Len() == 0 {
		return "(empty directory)", nil
	}
	return b.String(), nil
}
