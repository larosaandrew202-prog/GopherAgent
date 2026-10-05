package tools

import (
	"context"
	"errors"
	"fmt"
	"os/exec"
	"runtime"
	"strings"
	"time"

	"GopherAgent/internal/consts"
)

// BashTool runs a shell command in the working directory.
type BashTool struct{}

func (BashTool) Name() string { return consts.ToolBash }

func (BashTool) Description() string {
	return "Run a shell command in the working directory and return its combined stdout/stderr. " +
		"Use it to inspect files, run builds/tests, or automate the local machine. " +
		"On Windows commands run through PowerShell; elsewhere through bash."
}

func (BashTool) Parameters() map[string]interface{} {
	return map[string]interface{}{
		"type": "object",
		"properties": map[string]interface{}{
			"command": map[string]interface{}{
				"type":        "string",
				"description": "The shell command to execute.",
			},
			"timeout": map[string]interface{}{
				"type":        "integer",
				"description": "Timeout in seconds (default 60, max 600).",
			},
		},
		"required": []string{"command"},
	}
}

func (BashTool) Execute(ctx context.Context, args map[string]interface{}, ec ExecContext) (string, error) {
	command := strings.TrimSpace(strArg(args, "command"))
	if command == "" {
		return "", errors.New("command is required")
	}
	seconds := intArg(args, "timeout", 60)
	if seconds < 1 {
		seconds = 1
	}
	if seconds > 600 {
		seconds = 600
	}

	runCtx, cancel := context.WithTimeout(ctx, time.Duration(seconds)*time.Second)
	defer cancel()

	var cmd *exec.Cmd
	if runtime.GOOS == "windows" {
		cmd = exec.CommandContext(runCtx, "powershell", "-NoProfile", "-NonInteractive", "-Command", command)
	} else {
		cmd = exec.CommandContext(runCtx, "bash", "-lc", command)
	}
	if ec.WorkDir != "" {
		cmd.Dir = ec.WorkDir
	}

	out, err := cmd.CombinedOutput()
	text := strings.TrimRight(string(out), "\r\n")
	if err != nil {
		if runCtx.Err() == context.DeadlineExceeded {
			return text, fmt.Errorf("command timed out after %ds", seconds)
		}
		if text == "" {
			text = err.Error()
		}
		return text, fmt.Errorf("command failed: %v", err)
	}
	if strings.TrimSpace(text) == "" {
		return "(no output)", nil
	}
	return text, nil
}
