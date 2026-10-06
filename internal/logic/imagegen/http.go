package imagegen

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"strings"
)

// maxImageBytes caps both generated image payloads and downloaded reference
// images to bound memory use.
const maxImageBytes = 32 << 20

// httpClient has no client timeout: generation requests are bounded by the
// per-call context created in Generate.
var httpClient = &http.Client{}

func applyHeaders(req *http.Request, headers map[string]string) {
	for k, v := range headers {
		req.Header.Set(k, v)
	}
}

// doJSON performs a JSON request and decodes the body into out (when non-nil).
func doJSON(ctx context.Context, method, url string, headers map[string]string, payload, out interface{}) error {
	var body io.Reader
	if payload != nil {
		raw, err := json.Marshal(payload)
		if err != nil {
			return err
		}
		body = bytes.NewReader(raw)
	}
	req, err := http.NewRequestWithContext(ctx, method, url, body)
	if err != nil {
		return err
	}
	if payload != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	req.Header.Set("Accept", "application/json")
	applyHeaders(req, headers)

	resp, err := httpClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(resp.Body, maxImageBytes))
	if resp.StatusCode >= 400 {
		return fmt.Errorf("HTTP %d: %s", resp.StatusCode, extractErr(raw))
	}
	if out == nil {
		return nil
	}
	if err := json.Unmarshal(raw, out); err != nil {
		return fmt.Errorf("decode response: %w", err)
	}
	return nil
}

type filePart struct {
	field string
	name  string
	data  []byte
}

// postMultipart performs a multipart/form-data request (used by OpenAI edits).
func postMultipart(ctx context.Context, url string, headers map[string]string, fields map[string]string, files []filePart, out interface{}) error {
	var buf bytes.Buffer
	w := multipart.NewWriter(&buf)
	for k, v := range fields {
		if err := w.WriteField(k, v); err != nil {
			return err
		}
	}
	for _, f := range files {
		fw, err := w.CreateFormFile(f.field, f.name)
		if err != nil {
			return err
		}
		if _, err := fw.Write(f.data); err != nil {
			return err
		}
	}
	if err := w.Close(); err != nil {
		return err
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, &buf)
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", w.FormDataContentType())
	req.Header.Set("Accept", "application/json")
	applyHeaders(req, headers)

	resp, err := httpClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(resp.Body, maxImageBytes))
	if resp.StatusCode >= 400 {
		return fmt.Errorf("HTTP %d: %s", resp.StatusCode, extractErr(raw))
	}
	if out == nil {
		return nil
	}
	if err := json.Unmarshal(raw, out); err != nil {
		return fmt.Errorf("decode response: %w", err)
	}
	return nil
}

// extractErr pulls a human-readable message out of a provider error envelope.
func extractErr(raw []byte) string {
	var env struct {
		Error   interface{} `json:"error"`
		Message string      `json:"message"`
		Msg     string      `json:"msg"`
	}
	if json.Unmarshal(raw, &env) == nil {
		if env.Message != "" {
			return env.Message
		}
		if env.Msg != "" {
			return env.Msg
		}
		switch e := env.Error.(type) {
		case string:
			if e != "" {
				return e
			}
		case map[string]interface{}:
			for _, k := range []string{"message", "msg", "code"} {
				if v, ok := e[k].(string); ok && v != "" {
					return v
				}
			}
		}
	}
	s := strings.TrimSpace(string(raw))
	if len(s) > 300 {
		s = s[:300]
	}
	if s == "" {
		s = "request failed"
	}
	return s
}

func downloadBytes(ctx context.Context, url string) ([]byte, string, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, "", err
	}
	resp, err := httpClient.Do(req)
	if err != nil {
		return nil, "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		return nil, "", fmt.Errorf("HTTP %d downloading image", resp.StatusCode)
	}
	data, err := io.ReadAll(io.LimitReader(resp.Body, maxImageBytes))
	if err != nil {
		return nil, "", err
	}
	return data, resp.Header.Get("Content-Type"), nil
}

// decodeRef returns raw bytes for a base64 string or a (local/remote) URL.
func decodeRef(ctx context.Context, b64, url string) ([]byte, string, error) {
	if b64 != "" {
		raw, err := base64.StdEncoding.DecodeString(b64)
		if err != nil {
			return nil, "", err
		}
		return raw, sniffExt(raw, ""), nil
	}
	if url != "" {
		raw, ct, err := downloadBytes(ctx, url)
		if err != nil {
			return nil, "", err
		}
		return raw, sniffExt(raw, ct), nil
	}
	return nil, "", nil
}

func sniffExt(data []byte, contentType string) string {
	switch {
	case len(data) >= 4 && string(data[:4]) == "RIFF":
		return "webp"
	case len(data) >= 3 && data[0] == 0xff && data[1] == 0xd8 && data[2] == 0xff:
		return "jpg"
	case len(data) >= 8 && string(data[:8]) == "\x89PNG\r\n\x1a\n":
		return "png"
	}
	ct := strings.ToLower(contentType)
	switch {
	case strings.Contains(ct, "jpeg") || strings.Contains(ct, "jpg"):
		return "jpg"
	case strings.Contains(ct, "webp"):
		return "webp"
	default:
		return "png"
	}
}
