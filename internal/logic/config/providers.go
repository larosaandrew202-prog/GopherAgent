package config

import (
	"errors"
	"fmt"
	"strings"

	"GopherAgent/internal/consts"
)

// Provider describes a chat vendor and how its credentials are stored.
type Provider struct {
	// ID is the stable provider identifier (e.g. "deepseek").
	ID string
	// Label is the human readable name.
	Label string
	// APIKeyField / APIBaseField are the flat config.json keys holding the
	// vendor credential. Empty means the vendor does not expose the field.
	APIKeyField  string
	APIBaseField string
	// APIBaseDefault is used when no api base is configured.
	APIBaseDefault string
	// APIBasePlaceholder is a hint shown in the console.
	APIBasePlaceholder string
	// Models lists the models offered by the provider.
	Models []string
}

// Providers is the ordered provider catalogue, mirroring the vendors that
// CowAgent supports through an OpenAI-compatible /chat/completions endpoint.
var Providers = []*Provider{
	{
		ID:             "deepseek",
		Label:          "DeepSeek",
		APIKeyField:    consts.CfgDeepSeekAPIKey,
		APIBaseField:   consts.CfgDeepSeekAPIBase,
		APIBaseDefault: "https://api.deepseek.com/v1",
		Models:         []string{"deepseek-v4-flash", "deepseek-v4-pro", "deepseek-chat", "deepseek-reasoner"},
	},
	{
		ID:             "openai",
		Label:          "OpenAI",
		APIKeyField:    consts.CfgOpenAIAPIKey,
		APIBaseField:   consts.CfgOpenAIAPIBase,
		APIBaseDefault: "https://api.openai.com/v1",
		Models:         []string{"gpt-5.6-luna", "gpt-5.6-terra", "gpt-5.6-sol", "gpt-5.5", "gpt-5.4", "gpt-4.1", "gpt-4o", "o1-mini"},
	},
	{
		ID:             "claudeAPI",
		Label:          "Claude",
		APIKeyField:    consts.CfgClaudeAPIKey,
		APIBaseField:   consts.CfgClaudeAPIBase,
		APIBaseDefault: "https://api.anthropic.com/v1",
		Models:         []string{"claude-opus-5", "claude-sonnet-5", "claude-fable-5", "claude-opus-4-8", "claude-sonnet-4-6"},
	},
	{
		ID:             "gemini",
		Label:          "Gemini",
		APIKeyField:    consts.CfgGeminiAPIKey,
		APIBaseField:   consts.CfgGeminiAPIBase,
		APIBaseDefault: "https://generativelanguage.googleapis.com/v1beta/openai",
		Models:         []string{"gemini-3.7-flash", "gemini-3.6-flash", "gemini-3.5-flash", "gemini-3-pro-preview", "gemini-3.1-flash-lite-preview"},
	},
	{
		ID:             "zhipu",
		Label:          "GLM",
		APIKeyField:    consts.CfgZhipuAPIKey,
		APIBaseField:   consts.CfgZhipuAPIBase,
		APIBaseDefault: "https://open.bigmodel.cn/api/paas/v4",
		Models:         []string{"glm-5.3-flash", "glm-5.3", "glm-5.2", "glm-5.1", "glm-5-turbo", "glm-4"},
	},
	{
		ID:             "dashscope",
		Label:          "Qwen",
		APIKeyField:    consts.CfgDashscopeAPIKey,
		APIBaseField:   "",
		APIBaseDefault: "https://dashscope.aliyuncs.com/compatible-mode/v1",
		Models:         []string{"qwen3.8-flash", "qwen3.8-max", "qwen3.7-plus", "qwen3.7-max", "qwen3-max"},
	},
	{
		ID:             "moonshot",
		Label:          "Kimi",
		APIKeyField:    consts.CfgMoonshotAPIKey,
		APIBaseField:   consts.CfgMoonshotAPIBase,
		APIBaseDefault: "https://api.moonshot.cn/v1",
		Models:         []string{"kimi-k3", "kimi-k2.7-code", "kimi-k2.6", "kimi-k2.5", "kimi-k2"},
	},
	{
		ID:             "doubao",
		Label:          "Doubao",
		APIKeyField:    consts.CfgArkAPIKey,
		APIBaseField:   consts.CfgArkAPIBase,
		APIBaseDefault: "https://ark.cn-beijing.volces.com/api/v3",
		Models:         []string{"doubao-seed-2.1-pro", "doubao-seed-2.1-turbo", "doubao-seed-2-code"},
	},
	{
		ID:             "qianfan",
		Label:          "ERNIE",
		APIKeyField:    consts.CfgQianfanAPIKey,
		APIBaseField:   consts.CfgQianfanAPIBase,
		APIBaseDefault: "https://qianfan.baidubce.com/v2",
		Models:         []string{"ernie-5.1", "ernie-5.0", "ernie-x1.1", "ernie-4.5-turbo-128k", "ernie-4.5-turbo-32k"},
	},
	{
		ID:             "minimax",
		Label:          "MiniMax",
		APIKeyField:    consts.CfgMinimaxAPIKey,
		APIBaseField:   "",
		APIBaseDefault: "https://api.minimaxi.com/v1",
		Models:         []string{"MiniMax-M3", "MiniMax-M2.7", "MiniMax-M2.7-highspeed"},
	},
	{
		ID:             "mimo",
		Label:          "MiMo",
		APIKeyField:    consts.CfgMimoAPIKey,
		APIBaseField:   consts.CfgMimoAPIBase,
		APIBaseDefault: "https://api.xiaomimimo.com/v1",
		Models:         []string{"mimo-v2.5-pro", "mimo-v2.5"},
	},
	{
		ID:             "custom",
		Label:          "Custom",
		APIKeyField:    consts.CfgCustomAPIKey,
		APIBaseField:   consts.CfgCustomAPIBase,
		APIBaseDefault: "",
		Models:         []string{},
	},
}

var providerByID = func() map[string]*Provider {
	m := make(map[string]*Provider, len(Providers))
	for _, p := range Providers {
		m[p.ID] = p
	}
	return m
}()

// GetProvider returns a provider by ID, or nil when unknown. A few legacy
// aliases used by CowAgent are normalised first.
func GetProvider(id string) *Provider {
	id = normalizeProviderID(id)
	return providerByID[id]
}

func normalizeProviderID(id string) string {
	switch strings.ToLower(strings.TrimSpace(id)) {
	case "open_ai", "chatgpt", "azure", "chatgptonazure":
		return "openai"
	case "qwen", "qwen_dashscope":
		return "dashscope"
	case "zhipu_ai", "glm-4", "glm":
		return "zhipu"
	case "claudeapi", "claude":
		return "claudeAPI"
	default:
		return strings.TrimSpace(id)
	}
}

// InferProvider guesses the provider from a model name.
func InferProvider(model string) *Provider {
	m := strings.ToLower(strings.TrimSpace(model))
	switch {
	case m == "":
		return providerByID["deepseek"]
	case strings.HasPrefix(m, "deepseek"):
		return providerByID["deepseek"]
	case strings.HasPrefix(m, "claude"):
		return providerByID["claudeAPI"]
	case strings.HasPrefix(m, "gemini"):
		return providerByID["gemini"]
	case strings.HasPrefix(m, "glm"):
		return providerByID["zhipu"]
	case strings.HasPrefix(m, "qwen") || strings.HasPrefix(m, "qwq"):
		return providerByID["dashscope"]
	case strings.HasPrefix(m, "kimi") || strings.HasPrefix(m, "moonshot"):
		return providerByID["moonshot"]
	case strings.HasPrefix(m, "doubao"):
		return providerByID["doubao"]
	case strings.HasPrefix(m, "ernie"):
		return providerByID["qianfan"]
	case strings.HasPrefix(m, "minimax") || strings.HasPrefix(m, "abab"):
		return providerByID["minimax"]
	case strings.HasPrefix(m, "mimo"):
		return providerByID["mimo"]
	case strings.HasPrefix(m, "gpt"), strings.HasPrefix(m, "o1"), strings.HasPrefix(m, "o3"), strings.HasPrefix(m, "o4"):
		return providerByID["openai"]
	default:
		return providerByID["deepseek"]
	}
}

// Resolved holds the concrete credentials and endpoint for a chat request.
type Resolved struct {
	Provider   *Provider
	ProviderID string
	APIKey     string
	APIBase    string
	Model      string
}

// Resolve determines which provider and credentials to use for a chat call.
// botType (config "bot_type") takes precedence; when empty the provider is
// inferred from the model name.
func Resolve(model, botType string) (*Resolved, error) {
	s := C()
	if model == "" {
		model = s.GetString(consts.CfgModel)
	}

	// Custom (OpenAI-compatible) providers, addressed by "custom:<id>".
	if strings.HasPrefix(botType, consts.CustomProviderPrefix) {
		return resolveCustom(strings.TrimPrefix(botType, consts.CustomProviderPrefix), model)
	}

	var provider *Provider
	if botType != "" && normalizeProviderID(botType) != "custom" {
		provider = GetProvider(botType)
	}
	if provider == nil {
		provider = InferProvider(model)
	}
	if provider == nil {
		return nil, fmt.Errorf("cannot determine provider for model %q", model)
	}

	if provider.ID == "custom" {
		return resolveCustom("", model)
	}

	apiBase := provider.APIBaseDefault
	if provider.APIBaseField != "" {
		if v := s.GetString(provider.APIBaseField); v != "" {
			apiBase = v
		}
	}
	apiBase = strings.TrimRight(strings.TrimSpace(apiBase), "/")

	apiKey := ""
	if provider.APIKeyField != "" {
		apiKey = strings.TrimSpace(s.GetString(provider.APIKeyField))
	}
	// Fall back to the shared OpenAI key for OpenAI-compatible vendors.
	if apiKey == "" {
		apiKey = strings.TrimSpace(s.GetString(consts.CfgOpenAIAPIKey))
	}
	if apiKey == "" {
		return nil, fmt.Errorf("API key for provider %q is not configured", provider.Label)
	}
	if apiBase == "" {
		return nil, fmt.Errorf("API base for provider %q is not configured", provider.Label)
	}

	return &Resolved{Provider: provider, ProviderID: provider.ID, APIKey: apiKey, APIBase: apiBase, Model: model}, nil
}

// resolveCustom handles the "custom" provider and "custom:<id>" entries.
func resolveCustom(id, model string) (*Resolved, error) {
	s := C()
	provider := providerByID["custom"]

	// Prefer the expanded custom_providers list when an id is given.
	if id != "" {
		raw, _ := s.Get(consts.CfgCustomProviders).([]interface{})
		for _, item := range raw {
			entry, ok := item.(map[string]interface{})
			if !ok {
				continue
			}
			if asString(entry["id"]) != id {
				continue
			}
			apiKey := asString(entry["api_key"])
			apiBase := strings.TrimRight(asString(entry["api_base"]), "/")
			customModel := asString(entry["model"])
			if customModel != "" {
				model = customModel
			}
			if apiKey == "" || apiBase == "" {
				return nil, errors.New("custom provider is missing api_key or api_base")
			}
			return &Resolved{Provider: provider, ProviderID: consts.CustomProviderPrefix + id, APIKey: apiKey, APIBase: apiBase, Model: model}, nil
		}
		return nil, fmt.Errorf("custom provider %q not found", id)
	}

	apiKey := strings.TrimSpace(s.GetString(consts.CfgCustomAPIKey))
	apiBase := strings.TrimRight(strings.TrimSpace(s.GetString(consts.CfgCustomAPIBase)), "/")
	if apiKey == "" || apiBase == "" {
		return nil, errors.New("custom_api_key/custom_api_base are not configured")
	}
	return &Resolved{Provider: provider, ProviderID: "custom", APIKey: apiKey, APIBase: apiBase, Model: model}, nil
}

func asString(v interface{}) string {
	if s, ok := v.(string); ok {
		return strings.TrimSpace(s)
	}
	return ""
}

// Placeholder returns the API base hint shown in the console.
func Placeholder(p *Provider) string {
	if p == nil {
		return ""
	}
	if p.APIBasePlaceholder != "" {
		return p.APIBasePlaceholder
	}
	if p.APIBaseDefault == "" {
		return ""
	}
	return "https://...../v1"
}
