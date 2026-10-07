package api

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestReadTail(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "run.log")
	var b strings.Builder
	for i := 1; i <= 500; i++ {
		fmt.Fprintf(&b, "line %d\n", i)
	}
	if err := os.WriteFile(path, []byte(b.String()), 0o644); err != nil {
		t.Fatal(err)
	}

	got, err := readTail(path, 200)
	if err != nil {
		t.Fatalf("readTail: %v", err)
	}
	lines := strings.Split(got, "\n")
	if len(lines) != 200 {
		t.Fatalf("got %d lines, want 200", len(lines))
	}
	if lines[0] != "line 301" || lines[199] != "line 500" {
		t.Fatalf("unexpected window %q..%q", lines[0], lines[199])
	}
}

func TestReadTailMissingFile(t *testing.T) {
	if _, err := readTail(filepath.Join(t.TempDir(), "nope.log"), 10); err == nil {
		t.Fatal("expected an error for a missing file")
	}
}
