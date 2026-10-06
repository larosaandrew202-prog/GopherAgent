package tools

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestFileTools(t *testing.T) {
	dir := t.TempDir()
	ec := ExecContext{WorkDir: dir}
	reg := buildDefault()
	ctx := context.Background()

	if _, err := reg.Execute(ctx, "write", `{"path":"a.txt","content":"hello world"}`, ec); err != nil {
		t.Fatalf("write: %v", err)
	}
	out, err := reg.Execute(ctx, "read", `{"path":"a.txt"}`, ec)
	if err != nil || !strings.Contains(out, "hello world") {
		t.Fatalf("read: %q (%v)", out, err)
	}

	if _, err := reg.Execute(ctx, "edit", `{"path":"a.txt","old_string":"world","new_string":"gopher"}`, ec); err != nil {
		t.Fatalf("edit: %v", err)
	}
	data, _ := os.ReadFile(filepath.Join(dir, "a.txt"))
	if string(data) != "hello gopher" {
		t.Fatalf("edit result: %q", data)
	}

	out, err = reg.Execute(ctx, "ls", `{"path":"."}`, ec)
	if err != nil || !strings.Contains(out, "a.txt") {
		t.Fatalf("ls: %q (%v)", out, err)
	}
}

func TestEditRequiresUniqueMatch(t *testing.T) {
	dir := t.TempDir()
	ec := ExecContext{WorkDir: dir}
	reg := buildDefault()
	ctx := context.Background()

	_, _ = reg.Execute(ctx, "write", `{"path":"b.txt","content":"x x"}`, ec)
	if _, err := reg.Execute(ctx, "edit", `{"path":"b.txt","old_string":"x","new_string":"y"}`, ec); err == nil {
		t.Fatal("expected error for non-unique match")
	}
	if _, err := reg.Execute(ctx, "edit", `{"path":"b.txt","old_string":"x","new_string":"y","replace_all":true}`, ec); err != nil {
		t.Fatalf("replace_all: %v", err)
	}
}

func TestBashTool(t *testing.T) {
	reg := buildDefault()
	ctx := context.Background()
	out, err := reg.Execute(ctx, "bash", `{"command":"echo hi"}`, ExecContext{WorkDir: t.TempDir()})
	if err != nil {
		t.Fatalf("bash: %v (%s)", err, out)
	}
	if !strings.Contains(out, "hi") {
		t.Fatalf("bash output: %q", out)
	}
}

func TestUnknownTool(t *testing.T) {
	reg := buildDefault()
	if _, err := reg.Execute(context.Background(), "nope", `{}`, ExecContext{}); err == nil {
		t.Fatal("expected error for unknown tool")
	}
}

func TestImageGenToolRegistered(t *testing.T) {
	reg := buildDefault()
	tool, ok := reg.Get("image_gen")
	if !ok {
		t.Fatal("image_gen tool not registered")
	}
	if tool.Name() != "image_gen" {
		t.Fatalf("unexpected tool name %q", tool.Name())
	}
	if _, ok := reg.Get("image_gen"); !ok {
		t.Fatal("image_gen missing from registry")
	}
}

func TestStrSliceArg(t *testing.T) {
	if got := strSliceArg(map[string]interface{}{"image": "a.png"}, "image"); len(got) != 1 || got[0] != "a.png" {
		t.Fatalf("string form = %v", got)
	}
	got := strSliceArg(map[string]interface{}{"image": []interface{}{"a.png", "", "b.png"}}, "image")
	if len(got) != 2 || got[0] != "a.png" || got[1] != "b.png" {
		t.Fatalf("array form = %v", got)
	}
	if got := strSliceArg(map[string]interface{}{}, "image"); got != nil {
		t.Fatalf("missing = %v", got)
	}
}
