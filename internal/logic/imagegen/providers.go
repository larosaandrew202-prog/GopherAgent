package imagegen

import (
	"context"
	"encoding/base64"
	"fmt"
	"net/http"
	"os"
	"strings"
)

// ---------------------------------------------------------------------------
// shared helpers
// ---------------------------------------------------------------------------

type openAIImageItem struct {
	B64JSON string `json:"b64_json"`
	URL     string `json:"url"`
}

func readImageSource(ctx context.Context, src string) ([]byte, string, error) {
	src = strings.TrimSpace(src)
	if strings.HasPrefix(src, "http://") || strings.HasPrefix(src, "https://") {
		return downloadBytes(ctx, src)
	}
	data, err := os.ReadFile(src)
	if err != nil {
		return nil, "", fmt.Errorf("read image %s: %w", src, err)
	}
	return data, sniffExt(data, ""), nil
}

func mimeForExt(ext string) string {
	switch strings.ToLower(ext) {
	case "jpg", "jpeg":
		return "image/jpeg"
	case "webp":
		return "image/webp"
	default:
		return "image/png"
	}
}

func toDataURL(data []byte, ext string) string {
	return "data:" + mimeForExt(ext) + ";base64," + base64.StdEncoding.EncodeToString(data)
}

// resolveImageRef returns a URL or data-URL accepted by OpenAI-compatible
// vendors that take reference images inline.
func resolveImageRef(ctx context.Context, src string) (string, error) {
	if strings.HasPrefix(src, "http://") || strings.HasPrefix(src, "https://") {
		return src, nil
	}
	data, ext, err := readImageSource(ctx, src)
	if err != nil {
		return "", err
	}
	return toDataURL(data, ext), nil
}

func collectOpenAIData(ctx context.Context, items []openAIImageItem) ([]Result, error) {
	var out []Result
	for _, item := range items {
		if item.B64JSON != "" {
			raw, err := base64.StdEncoding.DecodeString(item.B64JSON)
			if err != nil {
				return nil, fmt.Errorf("decode b64 image: %w", err)
			}
			out = append(out, Result{Data: raw, Ext: sniffExt(raw, "")})
			continue
		}
		if item.URL != "" {
			raw, ct, err := downloadBytes(ctx, item.URL)
			if err != nil {
				return nil, err
			}
			out = append(out, Result{Data: raw, Ext: sniffExt(raw, ct)})
		}
	}
	return out, nil
}

// ---------------------------------------------------------------------------
// OpenAI-compatible (also used for custom endpoints)
// ---------------------------------------------------------------------------

type openAIProvider struct {
	name    string
	apiBase string
	apiKey  string
	model   string
}

func (p *openAIProvider) Name() string  { return p.name }
func (p *openAIProvider) Model() string { return p.model }

func (p *openAIProvider) Generate(ctx context.Context, req Request) ([]Result, error) {
	if len(req.Images) > 0 {
		return p.edit(ctx, req)
	}
	payload := map[string]interface{}{"model": p.model, "prompt": req.Prompt}
	if req.N > 1 {
		payload["n"] = req.N
	}
	if s := resolveOpenAISize(req.Size, req.AspectRatio); s != "" {
		payload["size"] = s
	}
	if q := normalizeQuality(req.Quality); q != "" {
		payload["quality"] = q
	}
	var out struct {
		Data []openAIImageItem `json:"data"`
	}
	headers := map[string]string{"Authorization": "Bearer " + p.apiKey}
	if err := doJSON(ctx, http.MethodPost, p.apiBase+"/images/generations", headers, payload, &out); err != nil {
		return nil, err
	}
	return collectOpenAIData(ctx, out.Data)
}

func (p *openAIProvider) edit(ctx context.Context, req Request) ([]Result, error) {
	fields := map[string]string{"model": p.model, "prompt": req.Prompt}
	if req.N > 1 {
		fields["n"] = fmt.Sprintf("%d", req.N)
	}
	if s := resolveOpenAISize(req.Size, req.AspectRatio); s != "" {
		fields["size"] = s
	}
	if q := normalizeQuality(req.Quality); q != "" {
		fields["quality"] = q
	}

	var files []filePart
	for i, src := range req.Images {
		data, ext, err := readImageSource(ctx, src)
		if err != nil {
			return nil, err
		}
		field := "image"
		if len(req.Images) > 1 {
			field = "image[]"
		}
		files = append(files, filePart{field: field, name: fmt.Sprintf("image_%d.%s", i, ext), data: data})
	}

	var out struct {
		Data []openAIImageItem `json:"data"`
	}
	headers := map[string]string{"Authorization": "Bearer " + p.apiKey}
	if err := postMultipart(ctx, p.apiBase+"/images/edits", headers, fields, files, &out); err != nil {
		return nil, err
	}
	return collectOpenAIData(ctx, out.Data)
}

// ---------------------------------------------------------------------------
// Google Gemini (Nano Banana image models)
// ---------------------------------------------------------------------------

type geminiProvider struct {
	apiBase string
	apiKey  string
	model   string
}

func (p *geminiProvider) Name() string  { return VendorGemini }
func (p *geminiProvider) Model() string { return p.model }

func (p *geminiProvider) Generate(ctx context.Context, req Request) ([]Result, error) {
	base := strings.TrimSuffix(p.apiBase, "/")
	base = strings.TrimSuffix(base, "/v1beta/openai")
	url := base + "/v1beta/models/" + p.model + ":generateContent"

	parts := []interface{}{map[string]interface{}{"text": req.Prompt}}
	for _, src := range req.Images {
		data, _, err := readImageSource(ctx, src)
		if err != nil {
			return nil, err
		}
		parts = append(parts, map[string]interface{}{
			"inline_data": map[string]interface{}{
				"mime_type": mimeForExt(sniffExt(data, "")),
				"data":      base64.StdEncoding.EncodeToString(data),
			},
		})
	}

	genCfg := map[string]interface{}{"responseModalities": []string{"IMAGE"}}
	if tier, ratio := geminiImageConfig(req.Size, req.AspectRatio); tier != "" || ratio != "" {
		ic := map[string]interface{}{}
		if tier != "" {
			ic["imageSize"] = tier
		}
		if ratio != "" {
			ic["aspectRatio"] = ratio
		}
		genCfg["imageConfig"] = ic
	}

	payload := map[string]interface{}{
		"contents":         []interface{}{map[string]interface{}{"parts": parts}},
		"generationConfig": genCfg,
	}
	var out struct {
		Candidates []struct {
			Content struct {
				Parts []struct {
					InlineData *struct {
						MimeType string `json:"mimeType"`
						Data     string `json:"data"`
					} `json:"inlineData"`
				} `json:"parts"`
			} `json:"content"`
		} `json:"candidates"`
	}
	headers := map[string]string{"x-goog-api-key": p.apiKey}
	if err := doJSON(ctx, http.MethodPost, url, headers, payload, &out); err != nil {
		return nil, err
	}

	var results []Result
	for _, c := range out.Candidates {
		for _, part := range c.Content.Parts {
			if part.InlineData == nil || part.InlineData.Data == "" {
				continue
			}
			raw, err := base64.StdEncoding.DecodeString(part.InlineData.Data)
			if err != nil {
				continue
			}
			results = append(results, Result{Data: raw, Ext: sniffExt(raw, part.InlineData.MimeType)})
		}
	}
	if len(results) == 0 {
		return nil, fmt.Errorf("gemini returned no image")
	}
	return results, nil
}

// ---------------------------------------------------------------------------
// Volcengine Ark (Seedream) — OpenAI-compatible /images/generations
// ---------------------------------------------------------------------------

type arkProvider struct {
	apiBase string
	apiKey  string
	model   string
}

func (p *arkProvider) Name() string  { return VendorArk }
func (p *arkProvider) Model() string { return p.model }

func (p *arkProvider) Generate(ctx context.Context, req Request) ([]Result, error) {
	payload := map[string]interface{}{
		"model":           p.model,
		"prompt":          req.Prompt,
		"response_format": "url",
		"watermark":       false,
	}
	if s := resolveArkSize(req.Size, req.AspectRatio); s != "" {
		payload["size"] = s
	}
	if len(req.Images) > 0 {
		refs := make([]string, 0, len(req.Images))
		for _, src := range req.Images {
			ref, err := resolveImageRef(ctx, src)
			if err != nil {
				return nil, err
			}
			refs = append(refs, ref)
		}
		if len(refs) == 1 {
			payload["image"] = refs[0]
		} else {
			payload["image"] = refs
		}
	}

	var out struct {
		Data []openAIImageItem `json:"data"`
	}
	headers := map[string]string{"Authorization": "Bearer " + p.apiKey}
	if err := doJSON(ctx, http.MethodPost, p.apiBase+"/images/generations", headers, payload, &out); err != nil {
		return nil, err
	}
	return collectOpenAIData(ctx, out.Data)
}

// ---------------------------------------------------------------------------
// Alibaba DashScope (Qwen image) — synchronous multimodal generation
// ---------------------------------------------------------------------------

type dashscopeProvider struct {
	apiBase string
	apiKey  string
	model   string
}

func (p *dashscopeProvider) Name() string  { return VendorDashscope }
func (p *dashscopeProvider) Model() string { return p.model }

func (p *dashscopeProvider) Generate(ctx context.Context, req Request) ([]Result, error) {
	content := make([]interface{}, 0, len(req.Images)+1)
	for _, src := range req.Images {
		ref, err := resolveImageRef(ctx, src)
		if err != nil {
			return nil, err
		}
		content = append(content, map[string]interface{}{"image": ref})
	}
	content = append(content, map[string]interface{}{"text": req.Prompt})

	payload := map[string]interface{}{
		"model": p.model,
		"input": map[string]interface{}{
			"messages": []interface{}{
				map[string]interface{}{"role": "user", "content": content},
			},
		},
	}
	if s := resolveQwenSize(req.Size, req.AspectRatio); s != "" {
		payload["parameters"] = map[string]interface{}{"size": s}
	}

	var out struct {
		Output struct {
			Choices []struct {
				Message struct {
					Content []struct {
						Image string `json:"image"`
					} `json:"content"`
				} `json:"message"`
			} `json:"choices"`
		} `json:"output"`
	}
	url := p.apiBase + "/api/v1/services/aigc/multimodal-generation/generation"
	headers := map[string]string{"Authorization": "Bearer " + p.apiKey}
	if err := doJSON(ctx, http.MethodPost, url, headers, payload, &out); err != nil {
		return nil, err
	}

	var results []Result
	for _, ch := range out.Output.Choices {
		for _, part := range ch.Message.Content {
			if part.Image == "" {
				continue
			}
			raw, ct, err := downloadBytes(ctx, part.Image)
			if err != nil {
				return nil, err
			}
			results = append(results, Result{Data: raw, Ext: sniffExt(raw, ct)})
		}
	}
	if len(results) == 0 {
		return nil, fmt.Errorf("qwen returned no image")
	}
	return results, nil
}

// ---------------------------------------------------------------------------
// MiniMax image-01
// ---------------------------------------------------------------------------

type minimaxProvider struct {
	apiBase string
	apiKey  string
	model   string
}

func (p *minimaxProvider) Name() string  { return VendorMinimax }
func (p *minimaxProvider) Model() string { return p.model }

func (p *minimaxProvider) Generate(ctx context.Context, req Request) ([]Result, error) {
	payload := map[string]interface{}{
		"model":           p.model,
		"prompt":          req.Prompt,
		"response_format": "base64",
	}
	if req.N > 1 {
		payload["n"] = req.N
	}
	if req.AspectRatio != "" {
		payload["aspect_ratio"] = req.AspectRatio
	}
	if len(req.Images) > 0 {
		refs := make([]interface{}, 0, len(req.Images))
		for _, src := range req.Images {
			ref, err := resolveImageRef(ctx, src)
			if err != nil {
				return nil, err
			}
			refs = append(refs, map[string]interface{}{"type": "character", "image_file": ref})
		}
		payload["subject_reference"] = refs
	}

	var out struct {
		Data struct {
			ImageBase64 []string `json:"image_base64"`
			ImageURLs   []string `json:"image_urls"`
		} `json:"data"`
	}
	url := p.apiBase + "/v1/image_generation"
	headers := map[string]string{"Authorization": "Bearer " + p.apiKey}
	if err := doJSON(ctx, http.MethodPost, url, headers, payload, &out); err != nil {
		return nil, err
	}

	var results []Result
	for _, b64 := range out.Data.ImageBase64 {
		raw, err := base64.StdEncoding.DecodeString(b64)
		if err != nil {
			continue
		}
		results = append(results, Result{Data: raw, Ext: sniffExt(raw, "")})
	}
	for _, u := range out.Data.ImageURLs {
		raw, ct, err := downloadBytes(ctx, u)
		if err != nil {
			return nil, err
		}
		results = append(results, Result{Data: raw, Ext: sniffExt(raw, ct)})
	}
	if len(results) == 0 {
		return nil, fmt.Errorf("minimax returned no image")
	}
	return results, nil
}
