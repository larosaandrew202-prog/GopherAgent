package api

import (
	"crypto/rand"
	"encoding/hex"
	"strings"

	"github.com/gogf/gf/v2/frame/g"
	"github.com/gogf/gf/v2/net/ghttp"
	"github.com/gogf/gf/v2/util/gconv"

	"GopherAgent/internal/consts"
	"GopherAgent/internal/logic/config"
	embeddinglogic "GopherAgent/internal/logic/embedding"
	memorylogic "GopherAgent/internal/logic/memory"
)

// GetModels returns the provider catalogue and capability state for the
// Models console.
func GetModels(r *ghttp.Request) {
	if !requireAuth(r) {
		return
	}
	s := config.C()

	providers := make([]g.Map, 0, len(config.Providers)+4)
	for _, p := range config.Providers {
		rawKey := ""
		if p.APIKeyField != "" {
			rawKey = s.GetString(p.APIKeyField)
		}
		base := p.APIBaseDefault
		if p.APIBaseField != "" {
			if v := s.GetString(p.APIBaseField); v != "" {
				base = v
			}
		}
		providers = append(providers, g.Map{
			"id":                   p.ID,
			"label":                p.Label,
			"configured":           rawKey != "",
			"is_custom":            false,
			"api_key_field":        p.APIKeyField,
			"api_base_field":       p.APIBaseField,
			"api_key_masked":       config.MaskKey(rawKey),
			"api_base":             base,
			"api_base_default":     p.APIBaseDefault,
			"api_base_placeholder": config.Placeholder(p),
			"models":               p.Models,
		})
	}
	for _, cp := range customProviders(s) {
		rawID := asString(cp["id"])
		id := consts.CustomProviderPrefix + rawID
		apiKey := asString(cp["api_key"])
		providers = append(providers, g.Map{
			"id":             id,
			"custom_id":      id,
			"custom_name":    asString(cp["name"]),
			"label":          asString(cp["name"]),
			"configured":     apiKey != "",
			"is_custom":      true,
			"api_base":       asString(cp["api_base"]),
			"api_key_masked": config.MaskKey(apiKey),
			"models":         []string{},
		})
	}

	providerIDs := make([]string, 0, len(providers))
	for _, p := range providers {
		providerIDs = append(providerIDs, gconv.String(p["id"]))
	}

	model := s.GetString(consts.CfgModel)
	botType := s.GetString(consts.CfgBotType)
	currentProvider := botType
	if currentProvider == "" {
		if p := config.InferProvider(model); p != nil {
			currentProvider = p.ID
		}
	}

	capabilities := g.Map{
		consts.CapabilityChat: g.Map{
			"editable":         true,
			"strategy":         "specified",
			"current_provider": currentProvider,
			"current_model":    model,
			"providers":        providerIDs,
		},
	}
	for _, id := range []string{
		consts.CapabilityVision, consts.CapabilityImage, consts.CapabilityASR,
		consts.CapabilityTTS,
	} {
		capabilities[id] = g.Map{
			"editable":  false,
			"providers": providerIDs,
		}
	}
	embeddingSettings := embeddinglogic.Resolve()
	embeddingProviderIDs := make([]string, 0)
	configuredEmbedding := make([]string, 0)
	for _, v := range embeddinglogic.Vendors() {
		pid := v["id"]
		embeddingProviderIDs = append(embeddingProviderIDs, pid)
		if meta := config.GetProvider(pid); meta != nil && meta.APIKeyField != "" {
			if s.GetString(meta.APIKeyField) != "" {
				configuredEmbedding = append(configuredEmbedding, pid)
			}
		}
	}
	capabilities[consts.CapabilityEmbedding] = g.Map{
		"editable":             true,
		"current_provider":     embeddingSettings.Provider,
		"current_model":        embeddingSettings.Model,
		"current_dim":          embeddingSettings.Dims,
		"configured_providers": configuredEmbedding,
		"providers":            embeddingProviderIDs,
		"provider_models":      embeddinglogic.VendorModels(),
	}
	searchConfigured := []string{}
	if s.GetString(consts.CfgBochaAPIKey) != "" {
		searchConfigured = append(searchConfigured, consts.SearchProviderBocha)
	}
	capabilities[consts.CapabilitySearch] = g.Map{
		"editable":             true,
		"strategy":             defaultString(s.GetString(consts.CfgWebSearchStrategy), consts.SearchStrategyAuto),
		"fixed_provider":       s.GetString(consts.CfgWebSearchProvider),
		"configured_providers": searchConfigured,
		"providers": []g.Map{
			{
				"id":             consts.SearchProviderBocha,
				"label":          "Bocha",
				"configured":     s.GetString(consts.CfgBochaAPIKey) != "",
				"api_key_masked": config.MaskKey(s.GetString(consts.CfgBochaAPIKey)),
			},
		},
	}

	ok(r, g.Map{"providers": providers, "capabilities": capabilities})
}

// ModelsAction handles the Models console actions.
func ModelsAction(r *ghttp.Request) {
	if !requireAuth(r) {
		return
	}
	body := r.GetMap()
	action := gconv.String(body["action"])
	s := config.C()

	switch action {
	case consts.ActionSetProvider:
		providerID := gconv.String(body["provider_id"])
		meta := config.GetProvider(providerID)
		if meta == nil {
			fail(r, "unknown provider: "+providerID)
			return
		}
		applied := false
		if _, has := body["api_base"]; has && meta.APIBaseField != "" {
			s.Set(meta.APIBaseField, strings.TrimSpace(gconv.String(body["api_base"])))
			applied = true
		}
		if key := strings.TrimSpace(gconv.String(body["api_key"])); key != "" && meta.APIKeyField != "" {
			s.Set(meta.APIKeyField, key)
			applied = true
		}
		if applied {
			if err := s.Save(); err != nil {
				fail(r, err.Error())
				return
			}
		}
		ok(r, g.Map{"provider": providerID, "noop": !applied})

	case consts.ActionDeleteProvider:
		providerID := gconv.String(body["provider_id"])
		meta := config.GetProvider(providerID)
		if meta == nil {
			fail(r, "unknown provider: "+providerID)
			return
		}
		for _, field := range []string{meta.APIKeyField, meta.APIBaseField} {
			if field != "" {
				s.Set(field, "")
			}
		}
		if err := s.Save(); err != nil {
			fail(r, err.Error())
			return
		}
		ok(r, g.Map{"provider": providerID})

	case consts.ActionSetCapability:
		capability := gconv.String(body["capability"])
		provider := gconv.String(body["provider"])
		if provider == "" {
			provider = gconv.String(body["provider_id"])
		}
		model := gconv.String(body["model"])
		if model == "" {
			model = gconv.String(body["model_name"])
		}
		if capability == consts.CapabilityChat {
			if model != "" {
				s.Set(consts.CfgModel, model)
			}
			if provider != "" {
				s.Set(consts.CfgBotType, provider)
			} else if model != "" {
				s.Set(consts.CfgBotType, "")
			}
			if err := s.Save(); err != nil {
				fail(r, err.Error())
				return
			}
		}
		if capability == consts.CapabilitySearch {
			strategy := gconv.String(body["strategy"])
			if strategy == "" {
				strategy = consts.SearchStrategyAuto
			}
			s.Set(consts.CfgWebSearchStrategy, strategy)
			if strategy == consts.SearchStrategyFixed {
				s.Set(consts.CfgWebSearchProvider, provider)
			} else {
				s.Set(consts.CfgWebSearchProvider, "")
			}
			if err := s.Save(); err != nil {
				fail(r, err.Error())
				return
			}
		}
		if capability == consts.CapabilityEmbedding {
			if provider != "" {
				s.Set(consts.CfgEmbeddingProvider, provider)
			}
			if model != "" {
				s.Set(consts.CfgEmbeddingModel, model)
			}
			if dims := gconv.Int(body["dimensions"]); dims > 0 {
				s.Set(consts.CfgEmbeddingDimensions, dims)
			}
			if err := s.Save(); err != nil {
				fail(r, err.Error())
				return
			}
			memorylogic.MarkDirty()
		}
		ok(r, g.Map{"capability": capability})

	case consts.ActionSetCustomProvider:
		id := gconv.String(body["id"])
		name := strings.TrimSpace(gconv.String(body["name"]))
		apiBase := strings.TrimSpace(gconv.String(body["api_base"]))
		apiKey := strings.TrimSpace(gconv.String(body["api_key"]))
		if name == "" {
			fail(r, "name is required")
			return
		}
		newID, err := upsertCustomProvider(s, id, name, apiBase, apiKey)
		if err != nil {
			fail(r, err.Error())
			return
		}
		ok(r, g.Map{"id": consts.CustomProviderPrefix + newID})

	case consts.ActionDeleteCustomProv:
		id := gconv.String(body["id"])
		if err := deleteCustomProvider(s, id); err != nil {
			fail(r, err.Error())
			return
		}
		ok(r, g.Map{})

	case consts.ActionSetSearchCredential:
		key := strings.TrimSpace(gconv.String(body["api_key"]))
		s.Set(consts.CfgBochaAPIKey, key)
		if err := s.Save(); err != nil {
			fail(r, err.Error())
			return
		}
		ok(r, g.Map{})

	case consts.ActionSetActiveCustomProv, consts.ActionSetVoiceReplyMode:
		// Accepted for console compatibility.
		ok(r, g.Map{})

	default:
		fail(r, "unknown action: "+action)
	}
}

// ---------------------------------------------------------------------------
// custom provider storage helpers
// ---------------------------------------------------------------------------

func customProviders(s *config.Store) []map[string]interface{} {
	raw, ok := s.Get(consts.CfgCustomProviders).([]interface{})
	if !ok {
		return nil
	}
	out := make([]map[string]interface{}, 0, len(raw))
	for _, item := range raw {
		m, ok := item.(map[string]interface{})
		if !ok || asString(m["id"]) == "" {
			continue
		}
		out = append(out, m)
	}
	return out
}

func upsertCustomProvider(s *config.Store, id, name, apiBase, apiKey string) (string, error) {
	id = strings.TrimPrefix(id, consts.CustomProviderPrefix)
	list := customProviders(s)

	if id == "" {
		id = randomID(8)
		for _, item := range list {
			if asString(item["id"]) == id {
				id = randomID(8)
			}
		}
		list = append(list, map[string]interface{}{
			"id":       id,
			"name":     name,
			"api_base": apiBase,
			"api_key":  apiKey,
			"model":    "",
		})
	} else {
		found := false
		for _, item := range list {
			if asString(item["id"]) != id {
				continue
			}
			found = true
			item["name"] = name
			if apiBase != "" {
				item["api_base"] = apiBase
			}
			if apiKey != "" {
				item["api_key"] = apiKey
			}
		}
		if !found {
			list = append(list, map[string]interface{}{
				"id": id, "name": name, "api_base": apiBase, "api_key": apiKey, "model": "",
			})
		}
	}

	normalized := make([]interface{}, len(list))
	for i, item := range list {
		normalized[i] = item
	}
	s.Set(consts.CfgCustomProviders, normalized)
	if err := s.Save(); err != nil {
		return "", err
	}
	return id, nil
}

func deleteCustomProvider(s *config.Store, id string) error {
	id = strings.TrimPrefix(id, consts.CustomProviderPrefix)
	list := customProviders(s)
	kept := make([]interface{}, 0, len(list))
	for _, item := range list {
		if asString(item["id"]) == id {
			continue
		}
		kept = append(kept, item)
	}
	s.Set(consts.CfgCustomProviders, kept)
	return s.Save()
}

func randomID(n int) string {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		return "custom"
	}
	return hex.EncodeToString(b)[:n]
}

func asString(v interface{}) string {
	if v == nil {
		return ""
	}
	if s, ok := v.(string); ok {
		return s
	}
	return gconv.String(v)
}

func defaultString(value, fallback string) string {
	if strings.TrimSpace(value) == "" {
		return fallback
	}
	return value
}
