package cmd

import (
	"context"
	"os"
	"strings"
	"testing"

	"github.com/gogf/gf/v2/frame/g"

	"GopherAgent/internal/logic/paths"
)

func TestSetupLoggingWritesFile(t *testing.T) {
	// Not t.TempDir(): the logger keeps the file open, and on Windows its
	// automatic cleanup would then fail. RemoveAll is best-effort here.
	dir, err := os.MkdirTemp("", "gopher-log-test-")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.RemoveAll(dir) })
	t.Setenv("GOPHER_DATA_DIR", dir)

	setupLogging()
	g.Log().Info(context.Background(), "hello-log-check")

	data, err := os.ReadFile(paths.LogFile())
	if err != nil {
		t.Fatalf("read log file: %v", err)
	}
	if !strings.Contains(string(data), "hello-log-check") {
		t.Fatalf("log file did not receive the line; contents: %q", data)
	}
	if !strings.Contains(string(data), "[INFO]") {
		t.Fatalf("log line is missing the [INFO] prefix; contents: %q", data)
	}
}
