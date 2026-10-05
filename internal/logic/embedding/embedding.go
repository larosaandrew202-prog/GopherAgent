// Package embedding provides OpenAI-compatible text embedding providers used
// by the long-term memory vector index.
package embedding

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"GopherAgent/internal/consts"
	configlogic "GopherAgent/internal/logic/config"
)

// vendor describes how to reach a vendor's embedding endpoint.
type vendor struct {
	id           string
	label        string
	apiKeyField  string
	apiBaseField string
	defaultBase  string
	defaultModel string
	defaultDims  int
	maxBatch     int
	queryPrefix  string
}

// vendors is intentionally limited to OpenAI-compatible /embeddings endpoints.
var vendors = []vendor{
	{
		id: "openai", label: "OpenAI",
		apiKeyField: consts.CfgOpenAIAPIKey, apiBaseField: consts.CfgOpenAIAPIBase,
		defaultBase: "https://api.openai.com/v1", defaultModel: "text-embedding-3-small",
		defaultDims: 1536, maxBatch: 64,
	},
	{
		id: "dashscope", label: "Qwen",
		apiKeyField: consts.CfgDashscopeAPIKey, apiBaseField: "",
		defaultBase: "https://dashscope.aliyuncs.com/compatible-mode/v1", defaultModel: "text-embedding-v4",
		defaultDims: 1024, maxBatch: 10,
	},
	{
		id: "zhipu", label: "GLM",
		apiKeyField: consts.CfgZhipuAPIKey, apiBaseField: consts.CfgZhipuAPIBase,
		defaultBase: "https://open.bigmodel.cn/api/paas/v4", defaultModel: "embedding-3",
		defaultDims: 1024, maxBatch: 64,
	},
	{
		id: "doubao", label: "Doubao",
		apiKeyField: consts.CfgArkAPIKey, apiBaseField: consts.CfgArkAPIBase,
		defaultBase: "https://ark.cn-beijing.volces.com/api/v3", defaultModel: "doubao-embedding-text-240715",
		defaultDims: 2560, maxBatch: 64,
	},
	{
		id: "custom", label: "Custom",
		apiKeyField: consts.CfgCustomAPIKey, apiBaseField: consts.CfgCustomAPIBase,
		defaultBase: "", defaultModel: "",
		defaultDims: 0, maxBatch: 64,
	},
}

var vendorByID = func() map[string]vendor {
	m := make(map[string]vendor, len(vendors))
	for _, v := range vendors {
		m[v.id] = v
	}
	return m
}()

// Vendors returns the provider ids and labels for the console.
func Vendors() []map[string]string {
	out := make([]map[string]string, 0, len(vendors))
	for _, v := range vendors {
		out = append(out, map[string]string{"id": v.id, "label": v.label})
	}
	return out
}

// VendorModels returns suggested embedding models per provider.
func VendorModels() map[string][]string {
	return map[string][]string{
		"openai":    {"text-embedding-3-small", "text-embedding-3-large", "text-embedding-ada-002"},
		"dashscope": {"text-embedding-v4", "text-embedding-v3"},
		"zhipu":     {"embedding-3", "embedding-2"},
		"doubao":    {"doubao-embedding-text-240715", "doubao-embedding-large-text-240915"},
		"custom":    {},
	}
}

// Settings is the resolved embedding configuration.
type Settings struct {
	Provider string
	Model    string
	APIKey   string
	APIBase  string
	Dims     int
}

// Resolve reads embedding settings from the config store.
func Resolve() Settings {
	s := configlogic.C()
	providerID := strings.TrimSpace(s.GetString(consts.CfgEmbeddingProvider))
	v, ok := vendorByID[providerID]
	if !ok {
		return Settings{}
	}
	key := strings.TrimSpace(s.GetString(consts.CfgEmbeddingAPIKey))
	if key == "" && v.apiKeyField != "" {
		key = strings.TrimSpace(s.GetString(v.apiKeyField))
	}
	base := strings.TrimSpace(s.GetString(consts.CfgEmbeddingAPIBase))
	if base == "" && v.apiBaseField != "" {
		base = strings.TrimSpace(s.GetString(v.apiBaseField))
	}
	if base == "" {
		base = v.defaultBase
	}
	model := strings.TrimSpace(s.GetString(consts.CfgEmbeddingModel))
	if model == "" {
		model = v.defaultModel
	}
	dims := s.GetInt(consts.CfgEmbeddingDimensions, 0)
	if dims <= 0 {
		dims = v.defaultDims
	}
	return Settings{
		Provider: providerID,
		Model:    model,
		APIKey:   key,
		APIBase:  strings.TrimRight(base, "/"),
		Dims:     dims,
	}
}

// DefaultModel returns the default model for a provider id.
func DefaultModel(providerID string) string {
	if v, ok := vendorByID[providerID]; ok {
		return v.defaultModel
	}
	return ""
}

// DefaultBase returns the default base URL for a provider id.
func DefaultBase(providerID string) string {
	if v, ok := vendorByID[providerID]; ok {
		return v.defaultBase
	}
	return ""
}

// Provider generates embeddings for text.
type Provider interface {
	Embed(ctx context.Context, texts []string) ([][]float32, error)
	Name() string
	Model() string
	Dimensions() int
}

// FromConfig builds a provider from config. It returns (nil, nil) when no
// embedding provider is configured (embedding disabled).
func FromConfig() (Provider, error) {
	settings := Resolve()
	if settings.Provider == "" {
		return nil, nil
	}
	if settings.APIKey == "" {
		return nil, nil
	}
	v, ok := vendorByID[settings.Provider]
	if !ok {
		return nil, fmt.Errorf("unknown embedding provider %q", settings.Provider)
	}
	if settings.APIBase == "" {
		return nil, fmt.Errorf("embedding provider %q has no API base", settings.Provider)
	}
	return &openAIProvider{
		vendor:     v,
		model:      settings.Model,
		apiKey:     settings.APIKey,
		apiBase:    settings.APIBase,
		dims:       settings.Dims,
		timeout:    time.Duration(configlogic.C().GetInt(consts.CfgRequestTimeout, 180)) * time.Second,
		proxy:      configlogic.C().GetString(consts.CfgProxy),
		clientOnce: sync.Once{},
	}, nil
}

// openAIProvider calls a vendor's OpenAI-compatible /embeddings endpoint.
type openAIProvider struct {
	vendor  vendor
	model   string
	apiKey  string
	apiBase string
	dims    int
	timeout time.Duration
	proxy   string

	clientOnce sync.Once
	client     *http.Client
}

func (p *openAIProvider) Name() string    { return p.vendor.id }
func (p *openAIProvider) Model() string   { return p.model }
func (p *openAIProvider) Dimensions() int { return p.dims }

func (p *openAIProvider) httpClient() *http.Client {
	p.clientOnce.Do(func() {
		transport := &http.Transport{
			MaxIdleConns:        20,
			MaxIdleConnsPerHost: 10,
			IdleConnTimeout:     90 * time.Second,
			Proxy:               http.ProxyFromEnvironment,
		}
		if p.proxy != "" {
			if u, err := url.Parse(p.proxy); err == nil {
				transport.Proxy = http.ProxyURL(u)
			}
		}
		p.client = &http.Client{Transport: transport, Timeout: p.timeout}
	})
	return p.client
}

type embeddingsRequest struct {
	Model      string   `json:"model"`
	Input      []string `json:"input"`
	Dimensions int      `json:"dimensions,omitempty"`
}

type embeddingsResponse struct {
	Data []struct {
		Index     int       `json:"index"`
		Embedding []float64 `json:"embedding"`
	} `json:"data"`
	Error *struct {
		Message string `json:"message"`
	} `json:"error"`
}

// Embed returns one vector per input text, paginating by the vendor batch cap.
func (p *openAIProvider) Embed(ctx context.Context, texts []string) ([][]float32, error) {
	if len(texts) == 0 {
		return nil, nil
	}
	batchSize := p.vendor.maxBatch
	if batchSize <= 0 {
		batchSize = 64
	}

	out := make([][]float32, 0, len(texts))
	for start := 0; start < len(texts); start += batchSize {
		end := start + batchSize
		if end > len(texts) {
			end = len(texts)
		}
		vectors, err := p.embedBatch(ctx, texts[start:end])
		if err != nil {
			return nil, err
		}
		out = append(out, vectors...)
	}
	return out, nil
}

func (p *openAIProvider) embedBatch(ctx context.Context, texts []string) ([][]float32, error) {
	body := embeddingsRequest{Model: p.model, Input: texts}
	if p.dims > 0 && p.vendor.id != "dashscope" {
		// dashscope defaults fine without an explicit dimension; others accept it.
		body.Dimensions = p.dims
	}
	payload, err := json.Marshal(body)
	if err != nil {
		return nil, err
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, p.apiBase+"/embeddings", bytes.NewReader(payload))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+p.apiKey)

	resp, err := p.httpClient().Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	raw, err := io.ReadAll(io.LimitReader(resp.Body, 16<<20))
	if err != nil {
		return nil, err
	}
	if resp.StatusCode >= 400 {
		return nil, fmt.Errorf("embedding HTTP %d: %s", resp.StatusCode, strings.TrimSpace(truncate(string(raw), 300)))
	}

	var parsed embeddingsResponse
	if err := json.Unmarshal(raw, &parsed); err != nil {
		return nil, fmt.Errorf("embedding decode: %w", err)
	}
	if parsed.Error != nil && parsed.Error.Message != "" {
		return nil, fmt.Errorf("embedding error: %s", parsed.Error.Message)
	}
	if len(parsed.Data) != len(texts) {
		return nil, fmt.Errorf("embedding returned %d vectors for %d inputs", len(parsed.Data), len(texts))
	}

	out := make([][]float32, len(texts))
	for _, item := range parsed.Data {
		if item.Index < 0 || item.Index >= len(out) {
			continue
		}
		vec := make([]float32, len(item.Embedding))
		for i, f := range item.Embedding {
			vec[i] = float32(f)
		}
		out[item.Index] = vec
	}
	for i, vec := range out {
		if vec == nil {
			return nil, fmt.Errorf("embedding missing vector for input %d", i)
		}
	}
	return out, nil
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n]
}
