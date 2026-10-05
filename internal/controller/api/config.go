package api

import (
	"GopherAgent/utility"
	"strings"

	"github.com/gogf/gf/v2/frame/g"
	"github.com/gogf/gf/v2/net/ghttp"
	"github.com/gogf/gf/v2/util/gconv"

	"GopherAgent/internal/consts"
	"GopherAgent/internal/logic/config"
	memorylogic "GopherAgent/internal/logic/memory"
)

// permissionModes exposed to the console.
var permissionModes = []string{
	consts.PermissionReadOnly,
	consts.PermissionWorkspaceWrite,
	consts.PermissionFullAccess,
}

// editableKeys is the allow-list of configuration keys the console may change.
// Vendor credential fields are derived from the provider registry so they have
// a single source of truth.
var editableKeys = buildEditableKeys()

var editableKeySet = func() map[string]struct{} {
	m := make(map[string]struct{}, len(editableKeys))
	for _, k := range editableKeys {
		m[k] = struct{}{}
	}
	return m
}()

var intKeys = map[string]struct{}{
	consts.CfgAgentMaxContextTokens: {}, consts.CfgAgentMaxContextTurns: {},
	consts.CfgAgentMaxSteps: {}, consts.CfgRequestTimeout: {},
	consts.CfgEmbeddingDimensions: {}, consts.CfgMemoryMaxResults: {},
	consts.CfgMemoryFlushTurns: {}, consts.CfgMemoryChunkTokens: {}, consts.CfgMemoryChunkOverlap: {},
}
var boolKeys = map[string]struct{}{
	consts.CfgEnableThinking: {}, consts.CfgSelfEvolution: {},
	consts.CfgKnowledge: {}, consts.CfgAgent: {}, consts.CfgSubagentEnabled: {},
	consts.CfgMemoryAutoFlush: {},
}
var floatKeys = map[string]struct{}{
	consts.CfgTemperature: {}, consts.CfgTopP: {},
	consts.CfgFrequencyPenalty: {}, consts.CfgPresencePenalty: {},
	consts.CfgMemoryVectorWeight: {}, consts.CfgMemoryKeywordWeight: {},
	consts.CfgMemoryMinScore: {}, consts.CfgMemoryHalfLifeDays: {},
}

func buildEditableKeys() []string {
	keys := []string{
		consts.CfgCowLang, consts.CfgModel, consts.CfgBotType,
		consts.CfgOpenAIAPIBase, consts.CfgOpenAIAPIKey, consts.CfgCustomAPIBase, consts.CfgCustomAPIKey,
		consts.CfgBochaAPIKey, consts.CfgWebSearchProvider, consts.CfgWebSearchStrategy,
		consts.CfgEmbeddingProvider, consts.CfgEmbeddingModel, consts.CfgEmbeddingDimensions,
		consts.CfgEmbeddingAPIKey, consts.CfgEmbeddingAPIBase,
		consts.CfgMemoryVectorWeight, consts.CfgMemoryKeywordWeight, consts.CfgMemoryMaxResults,
		consts.CfgMemoryMinScore, consts.CfgMemoryHalfLifeDays, consts.CfgMemoryAutoFlush,
		consts.CfgMemoryFlushTurns, consts.CfgMemoryChunkTokens, consts.CfgMemoryChunkOverlap,
		consts.CfgCharacterDesc, consts.CfgTemperature, consts.CfgTopP, consts.CfgFrequencyPenalty,
		consts.CfgPresencePenalty, consts.CfgRequestTimeout, consts.CfgProxy,
		consts.CfgAgent, consts.CfgAgentMaxContextTokens, consts.CfgAgentMaxContextTurns,
		consts.CfgAgentMaxSteps, consts.CfgAgentWorkspace, consts.CfgAgentPermissionMode,
		consts.CfgDisabledTools, consts.CfgSubagentEnabled, consts.CfgEnableThinking,
		consts.CfgReasoningEffort, consts.CfgReasoningByModel, consts.CfgKnowledge,
		consts.CfgSelfEvolution, consts.CfgCustomProviders, consts.CfgWebPassword,
	}
	seen := make(map[string]struct{}, len(keys)+16)
	for _, k := range keys {
		seen[k] = struct{}{}
	}
	for _, p := range config.Providers {
		for _, field := range []string{p.APIKeyField, p.APIBaseField} {
			if field == "" {
				continue
			}
			if _, ok := seen[field]; ok {
				continue
			}
			seen[field] = struct{}{}
			keys = append(keys, field)
		}
	}
	return keys
}

// GetConfig returns the console configuration overview.
func GetConfig(r *ghttp.Request) {
	if !requireAuth(r) {
		return
	}
	s := config.C()

	apiKeys := g.Map{}
	apiBases := g.Map{}
	providers := g.Map{}

	for _, p := range config.Providers {
		providers[p.ID] = g.Map{
			"label":                p.Label,
			"models":               p.Models,
			"api_key_field":        p.APIKeyField,
			"api_base_key":         p.APIBaseField,
			"api_base_default":     p.APIBaseDefault,
			"api_base_placeholder": config.Placeholder(p),
		}
		if p.APIKeyField != "" {
			apiKeys[p.APIKeyField] = config.MaskKey(s.GetString(p.APIKeyField))
		}
		if p.APIBaseField != "" {
			base := s.GetString(p.APIBaseField)
			if base == "" {
				base = p.APIBaseDefault
			}
			apiBases[p.APIBaseField] = base
		}
	}
	for _, cp := range customProviders(s) {
		id := consts.CustomProviderPrefix + asString(cp["id"])
		models := []string{}
		if m := asString(cp["model"]); m != "" {
			models = []string{m}
		}
		providers[id] = g.Map{"label": asString(cp["name"]), "models": models}
	}

	maskedPwd := ""
	if pwd := s.GetString(consts.CfgWebPassword); pwd != "" {
		maskedPwd = strings.Repeat("*", len(pwd))
	}

	writeJSON(r, g.Map{
		"status":                    consts.StatusSuccess,
		"use_agent":                 s.GetBool(consts.CfgAgent),
		"title":                     "GopherAgent",
		"model":                     s.GetString(consts.CfgModel),
		"bot_type":                  s.GetString(consts.CfgBotType),
		"channel_type":              s.GetString(consts.CfgChannelType),
		"agent_max_context_tokens":  s.GetInt(consts.CfgAgentMaxContextTokens, 64000),
		"agent_max_context_turns":   s.GetInt(consts.CfgAgentMaxContextTurns, 30),
		"agent_max_steps":           s.GetInt(consts.CfgAgentMaxSteps, 30),
		"enable_thinking":           s.GetBool(consts.CfgEnableThinking),
		"reasoning_effort":          s.GetString(consts.CfgReasoningEffort),
		"reasoning_effort_by_model": s.GetStringMap(consts.CfgReasoningByModel),
		"self_evolution_enabled":    s.GetBool(consts.CfgSelfEvolution),
		"subagent_enabled":          s.GetBool(consts.CfgSubagentEnabled),
		"agent_permission_mode":     normalizePermission(s.GetString(consts.CfgAgentPermissionMode)),
		"permission_modes":          permissionModes,
		"api_bases":                 apiBases,
		"api_keys":                  apiKeys,
		"providers":                 providers,
		"web_password_masked":       maskedPwd,
	})
}

// SaveConfig applies console configuration updates.
func SaveConfig(r *ghttp.Request) {
	if !requireAuth(r) {
		return
	}
	var body struct {
		Updates map[string]interface{} `json:"updates"`
	}
	if err := parseBody(r, &body); err != nil || len(body.Updates) == 0 {
		fail(r, "no updates provided")
		return
	}

	s := config.C()
	applied := g.Map{}
	for key, value := range body.Updates {
		if _, ok := editableKeySet[key]; !ok {
			continue
		}
		coerced := coerce(key, value)
		if key == consts.CfgReasoningByModel {
			if _, ok := coerced.(map[string]interface{}); !ok {
				continue
			}
		}
		if key == consts.CfgAgentPermissionMode {
			coerced = normalizePermission(gconv.String(coerced))
		}
		//密码使用md5加盐
		if key == consts.CfgWebPassword {
			password, _ := value.(string)
			coerced = utility.MD5WithSalt(password, consts.PasswordSalt)
		}
		s.Set(key, coerced)
		applied[key] = coerced
	}
	if len(applied) == 0 {
		fail(r, "no valid keys to update")
		return
	}
	if err := s.Save(); err != nil {
		fail(r, err.Error())
		return
	}
	if memoryConfigChanged(applied) {
		memorylogic.MarkDirty()
	}

	ok(r, g.Map{"applied": applied})
}

// memoryConfigKeys are the settings whose change requires a memory re-index.
var memoryConfigKeys = map[string]struct{}{
	consts.CfgEmbeddingProvider: {}, consts.CfgEmbeddingModel: {}, consts.CfgEmbeddingDimensions: {},
	consts.CfgEmbeddingAPIKey: {}, consts.CfgEmbeddingAPIBase: {}, consts.CfgMemoryChunkTokens: {},
	consts.CfgMemoryChunkOverlap: {}, consts.CfgAgentWorkspace: {}, consts.CfgKnowledge: {},
}

func memoryConfigChanged(applied g.Map) bool {
	for key := range applied {
		if _, ok := memoryConfigKeys[key]; ok {
			return true
		}
	}
	return false
}

func coerce(key string, value interface{}) interface{} {
	if _, isInt := intKeys[key]; isInt {
		return gconv.Int(value)
	}
	if _, isBool := boolKeys[key]; isBool {
		return gconv.Bool(value)
	}
	if _, isFloat := floatKeys[key]; isFloat {
		return gconv.Float64(value)
	}
	return value
}

func normalizePermission(mode string) string {
	switch mode {
	case "read-only", consts.PermissionReadOnly:
		return consts.PermissionReadOnly
	case "workspace-write", consts.PermissionWorkspaceWrite:
		return consts.PermissionWorkspaceWrite
	case "full-access", consts.PermissionFullAccess:
		return consts.PermissionFullAccess
	default:
		return consts.PermissionFullAccess
	}
}
