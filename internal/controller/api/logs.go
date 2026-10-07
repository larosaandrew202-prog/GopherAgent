package api

import (
	"bufio"
	"encoding/json"
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/gogf/gf/v2/net/ghttp"

	"GopherAgent/internal/logic/paths"
)

// logTailLines is how much history the log view receives when it connects.
const logTailLines = 200

// logTailMaxBytes bounds the tail read so a huge log file cannot be slurped.
const logTailMaxBytes = 512 * 1024

// LogsStream tails the process log file over SSE: an `init` event carrying the
// last lines, then one `line` event per new line. Adapted from CowAgent's
// LogsHandler (channel/web/api/logs.py).
func LogsStream(r *ghttp.Request) {
	if !requireAuth(r) {
		return
	}
	r.Response.Header().Set("Content-Type", "text/event-stream; charset=utf-8")
	r.Response.Header().Set("Cache-Control", "no-cache")
	r.Response.Header().Set("X-Accel-Buffering", "no")

	logPath := paths.LogFile()

	// Replay recent history.
	if tail, err := readTail(logPath, logTailLines); err == nil {
		writeLogEvent(r, "init", tail)
	} else {
		writeLogEvent(r, "error", "run.log not found: "+err.Error())
		return
	}

	f, err := os.Open(logPath)
	if err != nil {
		return
	}
	defer f.Close()
	if _, err := f.Seek(0, io.SeekEnd); err != nil {
		return
	}

	ctx := r.Context()
	reader := bufio.NewReader(f)
	keepAlive := time.NewTicker(12 * time.Second)
	poll := time.NewTicker(400 * time.Millisecond)
	defer keepAlive.Stop()
	defer poll.Stop()

	for {
		line, readErr := reader.ReadString('\n')
		if line != "" {
			writeLogEvent(r, "line", line)
		}
		if readErr == nil {
			continue
		}
		// EOF (or a transient read error): wait for the file to grow, keeping
		// the connection alive, then try again.
		select {
		case <-ctx.Done():
			return
		case <-keepAlive.C:
			r.Response.Write(": keep-alive\n\n")
			r.Response.Flush()
		case <-poll.C:
		}
	}
}

// writeLogEvent emits one SSE data frame. The payload is JSON so newlines and
// quotes in a log line survive the wire.
func writeLogEvent(r *ghttp.Request, eventType, line string) {
	payload, err := json.Marshal(map[string]string{"type": eventType, "line": line})
	if err != nil {
		return
	}
	r.Response.Write("data: ")
	r.Response.Write(payload)
	r.Response.Write("\n\n")
	r.Response.Flush()
}

// readTail returns the last n lines of a file, reading at most logTailMaxBytes
// from the end.
func readTail(path string, n int) (string, error) {
	f, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer f.Close()

	info, err := f.Stat()
	if err != nil {
		return "", err
	}
	if _, err := f.Seek(-min64(info.Size(), logTailMaxBytes), io.SeekEnd); err != nil {
		return "", err
	}
	data, err := io.ReadAll(f)
	if err != nil {
		return "", err
	}
	text := string(data)
	// Drop a possibly partial first line when we started mid-file.
	if info.Size() > logTailMaxBytes {
		if i := strings.IndexByte(text, '\n'); i >= 0 {
			text = text[i+1:]
		}
	}
	lines := strings.Split(strings.TrimRight(text, "\n"), "\n")
	if len(lines) > n {
		lines = lines[len(lines)-n:]
	}
	return strings.Join(lines, "\n"), nil
}

func min64(a, b int64) int64 {
	if a < b {
		return a
	}
	return b
}

// LogsDownload serves the whole log file for offline troubleshooting.
func LogsDownload(r *ghttp.Request) {
	if !requireAuth(r) {
		return
	}
	logPath := paths.LogFile()
	if _, err := os.Stat(logPath); err != nil {
		r.Response.WriteStatus(404)
		return
	}
	r.Response.Header().Set("Content-Type", "text/plain; charset=utf-8")
	r.Response.Header().Set("Cache-Control", "no-store")
	r.Response.Header().Set("Content-Disposition", `attachment; filename="`+filepath.Base(logPath)+`"`)
	r.Response.ServeFile(logPath)
}
