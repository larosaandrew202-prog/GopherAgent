package tools

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"

	"GopherAgent/internal/consts"
)

const (
	maxFetchBytes = 512 * 1024
	maxFetchChars = 12000
)

// WebFetchTool fetches a URL and returns readable text.
type WebFetchTool struct{}

func (WebFetchTool) Name() string { return consts.ToolWebFetch }

func (WebFetchTool) Description() string {
	return "Fetch an HTTP(S) URL and return its text content (HTML is converted to plain text)."
}

func (WebFetchTool) Parameters() map[string]interface{} {
	return map[string]interface{}{
		"type": "object",
		"properties": map[string]interface{}{
			"url": map[string]interface{}{"type": "string", "description": "Absolute http(s) URL to fetch."},
			"max_chars": map[string]interface{}{
				"type":        "integer",
				"description": "Maximum characters to return (default 12000).",
			},
		},
		"required": []string{"url"},
	}
}

func (WebFetchTool) Execute(ctx context.Context, args map[string]interface{}, ec ExecContext) (string, error) {
	rawURL := strings.TrimSpace(strArg(args, "url"))
	if rawURL == "" {
		return "", errors.New("url is required")
	}
	parsed, err := url.Parse(rawURL)
	if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") {
		return "", fmt.Errorf("unsupported url: %s", rawURL)
	}
	if blockedHost(parsed.Hostname()) {
		return "", fmt.Errorf("refusing to fetch private/loopback host: %s", parsed.Hostname())
	}

	reqCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(reqCtx, http.MethodGet, rawURL, nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("User-Agent", "GopherAgent/0.2")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		return "", fmt.Errorf("HTTP %d fetching %s", resp.StatusCode, rawURL)
	}

	body, err := io.ReadAll(io.LimitReader(resp.Body, maxFetchBytes))
	if err != nil {
		return "", err
	}
	text := string(body)
	if strings.Contains(resp.Header.Get("Content-Type"), "html") {
		text = htmlToText(text)
	}

	limit := intArg(args, "max_chars", maxFetchChars)
	if limit < 500 {
		limit = 500
	}
	runes := []rune(strings.TrimSpace(text))
	if len(runes) > limit {
		text = string(runes[:limit]) + "\n... [truncated]"
	}
	return text, nil
}

var (
	tagRe       = regexp.MustCompile(`(?s)<(script|style)[^>]*>.*?</(script|style)>`)
	commentRe   = regexp.MustCompile(`(?s)<!--.*?-->`)
	anyTagRe    = regexp.MustCompile(`(?s)<[^>]+>`)
	blankLineRe = regexp.MustCompile(`\n{3,}`)
)

func htmlToText(html string) string {
	html = tagRe.ReplaceAllString(html, " ")
	html = commentRe.ReplaceAllString(html, " ")
	html = anyTagRe.ReplaceAllString(html, " ")
	html = strings.ReplaceAll(html, "&nbsp;", " ")
	html = strings.ReplaceAll(html, "&amp;", "&")
	html = strings.ReplaceAll(html, "&lt;", "<")
	html = strings.ReplaceAll(html, "&gt;", ">")
	html = strings.ReplaceAll(html, "&quot;", `"`)
	html = blankLineRe.ReplaceAllString(html, "\n\n")
	return strings.TrimSpace(html)
}

// blockedHost rejects loopback and private network targets to limit SSRF.
func blockedHost(host string) bool {
	if host == "" {
		return true
	}
	if strings.EqualFold(host, "localhost") {
		return true
	}
	ip := net.ParseIP(host)
	if ip == nil {
		return false
	}
	return ip.IsLoopback() || ip.IsPrivate() || ip.IsLinkLocalUnicast() || ip.IsUnspecified()
}
