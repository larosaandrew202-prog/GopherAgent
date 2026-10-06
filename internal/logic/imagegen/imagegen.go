// Package imagegen implements text-to-image (and image editing) generation
// across several vendor image APIs with automatic provider routing and
// failover. It reuses credentials already configured for the chat providers
// (OpenAI, Gemini, Doubao/Ark, DashScope, MiniMax) where possible.
package imagegen

import (
	"context"
	"fmt"
	"strings"
	"time"

	"GopherAgent/internal/consts"
	configlogic "GopherAgent/internal/logic/config"
)

// Vendor identifiers used by image_provider / auto routing.
const (
	VendorOpenAI    = "openai"
	VendorGemini    = "gemini"
	VendorArk       = "doubao"
	VendorDashscope = "dashscope"
	VendorMinimax   = "minimax"
	VendorCustom    = "custom"
)

// vendorOrder is the default auto-routing priority.
var vendorOrder = []string{VendorOpenAI, VendorGemini, VendorArk, VendorDashscope, VendorMinimax}

type vendorMeta struct {
	keyField     string
	baseField    string
	defaultBase  string
	defaultModel string
}

var vendors = map[string]vendorMeta{
	VendorOpenAI:    {consts.CfgOpenAIAPIKey, consts.CfgOpenAIAPIBase, "https://api.openai.com/v1", "gpt-image-1"},
	VendorGemini:    {consts.CfgGeminiAPIKey, consts.CfgGeminiAPIBase, "https://generativelanguage.googleapis.com", "gemini-2.5-flash-image"},
	VendorArk:       {consts.CfgArkAPIKey, consts.CfgArkAPIBase, "https://ark.cn-beijing.volces.com/api/v3", "doubao-seedream-5-0-260128"},
	VendorDashscope: {consts.CfgDashscopeAPIKey, "", "https://dashscope.aliyuncs.com", "qwen-image-2.0"},
	VendorMinimax:   {consts.CfgMinimaxAPIKey, "", "https://api.minimaxi.com", "image-01"},
}

// Request describes one image generation request.
type Request struct {
	Prompt      string
	Images      []string // optional input images (local path or URL) for edit/fusion
	Size        string   // tier (512/1K/2K/4K) or explicit WxH
	AspectRatio string
	Quality     string
	N           int
}

// Result is a single generated image.
type Result struct {
	Data []byte
	Ext  string
}

// Provider generates (and optionally edits) images.
type Provider interface {
	Name() string
	Model() string
	Generate(ctx context.Context, req Request) ([]Result, error)
}

// Options is the resolved image-generation configuration.
type Options struct {
	Enabled    bool
	ProviderID string
	Model      string
	APIKey     string
	APIBase    string
	Size       string
	Quality    string
	MaxPerCall int
	Fallback   bool
	Timeout    time.Duration
}

// OptionsFromConfig reads image settings from the runtime config store.
func OptionsFromConfig() Options {
	s := configlogic.C()
	timeout := s.GetInt(consts.CfgImageTimeoutSec, 300)
	if timeout <= 0 {
		timeout = 300
	}
	return Options{
		Enabled:    s.GetBool(consts.CfgImageEnabled),
		ProviderID: strings.TrimSpace(s.GetString(consts.CfgImageProvider)),
		Model:      strings.TrimSpace(s.GetString(consts.CfgImageModel)),
		APIKey:     strings.TrimSpace(s.GetString(consts.CfgImageAPIKey)),
		APIBase:    strings.TrimSpace(s.GetString(consts.CfgImageAPIBase)),
		Size:       strings.TrimSpace(s.GetString(consts.CfgImageSize)),
		Quality:    strings.TrimSpace(s.GetString(consts.CfgImageQuality)),
		MaxPerCall: s.GetInt(consts.CfgImageMaxPerCall, 1),
		Fallback:   s.GetBool(consts.CfgImageFallback),
		Timeout:    time.Duration(timeout) * time.Second,
	}
}

// Generate runs one request, trying the configured providers in order. It
// returns the provider/model that succeeded plus the generated images.
func Generate(ctx context.Context, opts Options, req Request) (providerName, model string, results []Result, err error) {
	providers := resolveProviders(opts)
	if len(providers) == 0 {
		return "", "", nil, fmt.Errorf(
			"no image provider configured: set an API key for openai/gemini/doubao/dashscope/minimax " +
				"(or image_api_key) and try again")
	}

	n := req.N
	if n <= 0 {
		n = 1
	}
	if opts.MaxPerCall > 0 && n > opts.MaxPerCall {
		n = opts.MaxPerCall
	}
	req.N = n

	timeout := opts.Timeout
	if timeout <= 0 {
		timeout = 300 * time.Second
	}

	var errs []string
	for _, p := range providers {
		cctx, cancel := context.WithTimeout(ctx, timeout)
		res, gerr := p.Generate(cctx, req)
		cancel()
		if gerr == nil && len(res) > 0 {
			return p.Name(), p.Model(), res, nil
		}
		if gerr == nil {
			gerr = fmt.Errorf("provider returned no image")
		}
		errs = append(errs, fmt.Sprintf("%s: %v", p.Name(), gerr))
		if !opts.Fallback {
			break
		}
	}
	return "", "", nil, fmt.Errorf("image generation failed: %s", strings.Join(errs, " | "))
}

// resolveProviders builds the ordered list of usable providers.
func resolveProviders(opts Options) []Provider {
	pref := strings.TrimSpace(opts.ProviderID)
	var ids []string
	switch {
	case strings.HasPrefix(pref, consts.CustomProviderPrefix):
		ids = []string{VendorCustom}
	case pref == "" || strings.EqualFold(pref, "auto"):
		ids = append(ids, vendorOrder...)
		if native := nativeVendor(opts.Model); native != "" {
			ids = promote(ids, native)
		}
	default:
		ids = []string{pref}
	}

	var out []Provider
	for _, id := range ids {
		if p, ok := newProvider(id, opts); ok {
			out = append(out, p)
		}
	}
	return out
}

func promote(ids []string, id string) []string {
	out := []string{id}
	for _, v := range ids {
		if v != id {
			out = append(out, v)
		}
	}
	return out
}

// nativeVendor infers the vendor that natively owns a model id.
func nativeVendor(model string) string {
	m := strings.ToLower(strings.TrimSpace(model))
	switch {
	case m == "":
		return ""
	case strings.HasPrefix(m, "gpt-image"), strings.HasPrefix(m, "dall-e"):
		return VendorOpenAI
	case strings.HasPrefix(m, "nano-banana"), strings.HasPrefix(m, "gemini"):
		return VendorGemini
	case strings.HasPrefix(m, "seedream"), strings.HasPrefix(m, "doubao-seedream"):
		return VendorArk
	case strings.HasPrefix(m, "qwen-image"), strings.HasPrefix(m, "wanx"), strings.HasPrefix(m, "qwen"):
		return VendorDashscope
	case strings.HasPrefix(m, "minimax"), strings.HasPrefix(m, "image-01"):
		return VendorMinimax
	default:
		return ""
	}
}

// newProvider builds a provider when its credentials are available.
func newProvider(id string, opts Options) (Provider, bool) {
	if id == VendorCustom {
		key, base, model := customCreds(opts)
		if key == "" || base == "" {
			return nil, false
		}
		return &openAIProvider{name: VendorCustom, apiBase: base, apiKey: key, model: defaultStr(model, "gpt-image-1")}, true
	}

	meta, ok := vendors[id]
	if !ok {
		return nil, false
	}
	s := configlogic.C()
	key := strings.TrimSpace(s.GetString(meta.keyField))
	base := meta.defaultBase
	if meta.baseField != "" {
		if b := strings.TrimSpace(s.GetString(meta.baseField)); b != "" {
			base = b
		}
	}
	if opts.APIKey != "" {
		key = opts.APIKey
	}
	if opts.APIBase != "" {
		base = opts.APIBase
	}
	if opts.Model != "" {
		meta.defaultModel = opts.Model
	}
	if key == "" || base == "" {
		return nil, false
	}
	base = strings.TrimRight(base, "/")

	switch id {
	case VendorOpenAI:
		return &openAIProvider{name: VendorOpenAI, apiBase: base, apiKey: key, model: meta.defaultModel}, true
	case VendorGemini:
		return &geminiProvider{apiBase: base, apiKey: key, model: meta.defaultModel}, true
	case VendorArk:
		return &arkProvider{apiBase: base, apiKey: key, model: meta.defaultModel}, true
	case VendorDashscope:
		return &dashscopeProvider{apiBase: base, apiKey: key, model: meta.defaultModel}, true
	case VendorMinimax:
		return &minimaxProvider{apiBase: base, apiKey: key, model: meta.defaultModel}, true
	default:
		return nil, false
	}
}

// customCreds resolves the flat custom credentials or a custom:<id> entry.
func customCreds(opts Options) (key, base, model string) {
	s := configlogic.C()
	if strings.HasPrefix(opts.ProviderID, consts.CustomProviderPrefix) {
		id := strings.TrimPrefix(opts.ProviderID, consts.CustomProviderPrefix)
		for _, raw := range asList(s.Get(consts.CfgCustomProviders)) {
			m, ok := raw.(map[string]interface{})
			if !ok || m["id"] != id {
				continue
			}
			key = strOf(m["api_key"])
			base = strings.TrimRight(strOf(m["api_base"]), "/")
			model = strOf(m["model"])
			break
		}
	} else {
		key = strings.TrimSpace(s.GetString(consts.CfgCustomAPIKey))
		base = strings.TrimRight(strings.TrimSpace(s.GetString(consts.CfgCustomAPIBase)), "/")
	}
	if opts.APIKey != "" {
		key = opts.APIKey
	}
	if opts.APIBase != "" {
		base = opts.APIBase
	}
	if opts.Model != "" {
		model = opts.Model
	}
	return key, base, model
}

func asList(v interface{}) []interface{} {
	if l, ok := v.([]interface{}); ok {
		return l
	}
	return nil
}

func strOf(v interface{}) string {
	if s, ok := v.(string); ok {
		return strings.TrimSpace(s)
	}
	return ""
}

func defaultStr(v, def string) string {
	if strings.TrimSpace(v) == "" {
		return def
	}
	return v
}
