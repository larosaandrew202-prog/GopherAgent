// Package consts holds shared string constants used across the backend so that
// configuration keys, agent event types, roles, tool names and table names have
// a single source of truth.
package consts

// Message roles (OpenAI chat format).
const (
	RoleSystem    = "system"
	RoleUser      = "user"
	RoleAssistant = "assistant"
	RoleTool      = "tool"
)

// Agent SSE event types (consumed by the console).
const (
	EventReasoning = "reasoning"
	EventDelta     = "delta"
	EventToolStart = "tool_start"
	EventToolEnd   = "tool_end"
	EventDone      = "done"
	EventStreamEnd = "stream_end"
	EventError     = "error"
	EventCancelled = "cancelled"
	// EventToolMedia carries generated media (e.g. images) produced by a tool.
	EventToolMedia = "tool_media"
)

// Built-in agent tool names.
const (
	ToolBash         = "bash"
	ToolRead         = "read"
	ToolWrite        = "write"
	ToolEdit         = "edit"
	ToolLs           = "ls"
	ToolWebFetch     = "web_fetch"
	ToolWebSearch    = "web_search"
	ToolMemorySearch = "memory_search"
	ToolMemoryGet    = "memory_get"
	ToolScheduler    = "scheduler"
	ToolImageGen     = "image_gen"
)

// Scheduled task schedule types.
const (
	ScheduleOnce     = "once"
	ScheduleInterval = "interval"
	ScheduleCron     = "cron"
)

// Scheduled task action types.
const (
	ActionSendMessage = "send_message"
	ActionAgentTask   = "agent_task"
)

// Tool / scheduler action names.
const (
	ToolActionCreate  = "create"
	ToolActionList    = "list"
	ToolActionGet     = "get"
	ToolActionDelete  = "delete"
	ToolActionEnable  = "enable"
	ToolActionDisable = "disable"
)

// Permission modes.
const (
	PermissionReadOnly       = "read_only"
	PermissionWorkspaceWrite = "workspace_write"
	PermissionFullAccess     = "full_access"
	// PermissionGlobal means "inherit the global permission".
	PermissionGlobal = "global"
)

// Tool execution statuses.
const (
	ToolStatusDone  = "done"
	ToolStatusError = "error"
)

// OpenAI function-calling type discriminator.
const ToolTypeFunction = "function"

// OpenAI tool_choice value used when tools are provided.
const ToolChoiceAuto = "auto"

// Attachment kinds surfaced to the model / console.
const AttachmentKindFile = "file"

// Media kinds produced by tools and surfaced to the console.
const (
	MediaTypeImage = "image"
	MediaTypeVideo = "video"
)

// Runtime data directory names (relative to the data root).
const DirUploads = "uploads"

// API envelope statuses.
const (
	StatusSuccess = "success"
	StatusError   = "error"
)

// In-chat commands.
const (
	CommandCancel       = "/cancel"
	CommandClear        = "/clear"
	CommandReloadConfig = "#更新配置"
)

// SQLite table names.
const (
	TableConfig         = "config"
	TableSessions       = "sessions"
	TableMessages       = "messages"
	TableScheduledTasks = "scheduled_tasks"
	TableMemoryChunks   = "memory_chunks"
	TableMemoryFiles    = "memory_files"
)

// Configuration keys (flat config store).
const (
	CfgModel                 = "model"
	CfgBotType               = "bot_type"
	CfgChannelType           = "channel_type"
	CfgCowLang               = "cow_lang"
	CfgCharacterDesc         = "character_desc"
	CfgTemperature           = "temperature"
	CfgTopP                  = "top_p"
	CfgFrequencyPenalty      = "frequency_penalty"
	CfgPresencePenalty       = "presence_penalty"
	CfgRequestTimeout        = "request_timeout"
	CfgProxy                 = "proxy"
	CfgClearMemoryCommands   = "clear_memory_commands"
	CfgAgent                 = "agent"
	CfgAgentWorkspace        = "agent_workspace"
	CfgAgentMaxContextTokens = "agent_max_context_tokens"
	CfgAgentMaxContextTurns  = "agent_max_context_turns"
	CfgAgentMaxSteps         = "agent_max_steps"
	CfgAgentPermissionMode   = "agent_permission_mode"
	CfgDisabledTools         = "disabled_tools"
	CfgDisabledSkills        = "disabled_skills"
	CfgSubagentEnabled       = "subagent_enabled"
	CfgEnableThinking        = "enable_thinking"
	CfgReasoningEffort       = "reasoning_effort"
	CfgReasoningByModel      = "reasoning_effort_by_model"
	CfgKnowledge             = "knowledge"
	CfgSelfEvolution         = "self_evolution_enabled"
	CfgWebPassword           = "web_password"
	CfgWebPort               = "web_port"
	CfgCustomProviders       = "custom_providers"
	CfgOpenAIAPIKey          = "open_ai_api_key"
	CfgOpenAIAPIBase         = "open_ai_api_base"
	CfgCustomAPIKey          = "custom_api_key"
	CfgCustomAPIBase         = "custom_api_base"
	CfgBochaAPIKey           = "bocha_api_key"
	CfgWebSearchProvider     = "web_search_provider"
	CfgWebSearchStrategy     = "web_search_strategy"
	CfgZhipuAPIKey           = "zhipu_ai_api_key"
	CfgZhipuAPIBase          = "zhipu_ai_api_base"
	CfgQianfanAPIKey         = "qianfan_api_key"
	CfgQianfanAPIBase        = "qianfan_api_base"
	CfgDeepSeekAPIKey        = "deepseek_api_key"
	CfgDeepSeekAPIBase       = "deepseek_api_base"
	CfgClaudeAPIKey          = "claude_api_key"
	CfgClaudeAPIBase         = "claude_api_base"
	CfgGeminiAPIKey          = "gemini_api_key"
	CfgGeminiAPIBase         = "gemini_api_base"
	CfgDashscopeAPIKey       = "dashscope_api_key"
	CfgMoonshotAPIKey        = "moonshot_api_key"
	CfgMoonshotAPIBase       = "moonshot_base_url"
	CfgArkAPIKey             = "ark_api_key"
	CfgArkAPIBase            = "ark_base_url"
	CfgMinimaxAPIKey         = "minimax_api_key"
	CfgMimoAPIKey            = "mimo_api_key"
	CfgMimoAPIBase           = "mimo_api_base"
)

// Long-term memory / embedding configuration keys.
const (
	CfgEmbeddingProvider   = "embedding_provider"
	CfgEmbeddingModel      = "embedding_model"
	CfgEmbeddingDimensions = "embedding_dimensions"
	CfgEmbeddingAPIKey     = "embedding_api_key"
	CfgEmbeddingAPIBase    = "embedding_api_base"
	CfgMemoryVectorWeight  = "memory_vector_weight"
	CfgMemoryKeywordWeight = "memory_keyword_weight"
	CfgMemoryMaxResults    = "memory_max_results"
	CfgMemoryMinScore      = "memory_min_score"
	CfgMemoryHalfLifeDays  = "memory_half_life_days"
	CfgMemoryAutoFlush     = "memory_auto_flush"
	CfgMemoryFlushTurns    = "memory_flush_turns"
	CfgMemoryChunkTokens   = "memory_chunk_tokens"
	CfgMemoryChunkOverlap  = "memory_chunk_overlap"
)

// Image generation configuration keys.
const (
	CfgImageEnabled    = "image_enabled"
	CfgImageProvider   = "image_provider"
	CfgImageModel      = "image_model"
	CfgImageAPIKey     = "image_api_key"
	CfgImageAPIBase    = "image_api_base"
	CfgImageSize       = "image_size"
	CfgImageQuality    = "image_quality"
	CfgImageMaxPerCall = "image_max_per_call"
	CfgImageTimeoutSec = "image_timeout_sec"
	CfgImageFallback   = "image_fallback"
	CfgImageOutputDir  = "image_output_dir"
)

// Redis configuration keys. Redis is optional; when it is disabled all
// coordination state stays in-process (single-node behaviour).
const (
	CfgRedisEnabled  = "redis_enabled"
	CfgRedisAddr     = "redis_addr"
	CfgRedisPassword = "redis_password"
	CfgRedisDB       = "redis_db"
	CfgRedisPrefix   = "redis_prefix"
)

// Memory chunk scopes and sources.
const (
	MemoryScopeShared   = "shared"
	MemoryScopeUser     = "user"
	MemorySourceMemory  = "memory"
	MemorySourceSession = "session"
)

// In-chat memory command.
const CommandMemory = "/memory"

// Custom provider bot_type prefix ("custom:<id>").
const CustomProviderPrefix = "custom:"

// Models console actions.
const (
	ActionSetProvider         = "set_provider"
	ActionDeleteProvider      = "delete_provider"
	ActionSetCustomProvider   = "set_custom_provider"
	ActionDeleteCustomProv    = "delete_custom_provider"
	ActionSetCapability       = "set_capability"
	ActionSetSearchCredential = "set_search_credential"
	ActionSetVoiceReplyMode   = "set_voice_reply_mode"
	ActionSetActiveCustomProv = "set_active_custom_provider"
)

// Model capabilities.
const (
	CapabilityChat      = "chat"
	CapabilitySearch    = "search"
	CapabilityVision    = "vision"
	CapabilityImage     = "image"
	CapabilityASR       = "asr"
	CapabilityTTS       = "tts"
	CapabilityEmbedding = "embedding"
)

// Web search providers.
const (
	SearchProviderBocha   = "bocha"
	SearchProviderQianfan = "qianfan"
	SearchProviderZhipu   = "zhipu"
)

// Web search strategies.
const (
	SearchStrategyAuto  = "auto"
	SearchStrategyFixed = "fixed"
)

const PasswordSalt = "fkTeD*Mx)#2F+V6vxJts"
