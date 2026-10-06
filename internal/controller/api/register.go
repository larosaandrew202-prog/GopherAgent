package api

import "github.com/gogf/gf/v2/net/ghttp"

// Register binds every console-facing route onto the server.
func Register(s *ghttp.Server) {
	// auth + meta
	s.BindHandler("GET:/auth/check", AuthCheck)
	s.BindHandler("POST:/auth/login", AuthLogin)
	s.BindHandler("POST:/auth/logout", AuthLogout)
	s.BindHandler("GET:/api/version", Version)
	s.BindHandler("GET:/api/health", Health)

	// config + models
	s.BindHandler("GET:/config", GetConfig)
	s.BindHandler("POST:/config", SaveConfig)
	s.BindHandler("GET:/api/models", GetModels)
	s.BindHandler("POST:/api/models", ModelsAction)
	s.BindHandler("POST:/api/prompt/optimize", OptimizePrompt)

	// chat
	s.BindHandler("POST:/message", PostMessage)
	s.BindHandler("GET:/stream", StreamChat)
	s.BindHandler("POST:/cancel", CancelChat)
	s.BindHandler("POST:/upload", Upload)

	// sessions (specific paths first)
	s.BindHandler("POST:/api/sessions/{id}/clear_context", ClearContext)
	s.BindHandler("POST:/api/sessions/{id}/generate_title", GenerateTitle)
	s.BindHandler("GET:/api/sessions/{id}/settings", GetSessionSettings)
	s.BindHandler("POST:/api/sessions/{id}/settings", UpdateSessionSettings)
	s.BindHandler("GET:/api/sessions", ListSessions)
	s.BindHandler("GET:/api/sessions/{id}", GetSession)
	s.BindHandler("PUT:/api/sessions/{id}", UpdateSession)
	s.BindHandler("DELETE:/api/sessions/{id}", DeleteSession)
	s.BindHandler("GET:/api/history", History)
	s.BindHandler("POST:/api/messages/delete", DeleteMessagesHandler)

	// projects + workspace
	s.BindHandler("GET:/api/projects", GetProjects)
	s.BindHandler("POST:/api/projects/select", SelectProject)
	s.BindHandler("POST:/api/projects/create", CreateProject)
	s.BindHandler("GET:/api/projects/browse", BrowseProjects)
	s.BindHandler("POST:/api/projects/order", ProjectAction)
	s.BindHandler("POST:/api/projects/manage", ProjectAction)
	s.BindHandler("GET:/api/workspace/meta", WorkspaceMeta)
	s.BindHandler("GET:/api/workspace/tree", WorkspaceTree)
	s.BindHandler("GET:/api/workspace/search", WorkspaceSearch)
	s.BindHandler("GET:/api/workspace/resolve", WorkspaceResolve)
	s.BindHandler("GET:/api/file", ServeFile)
	s.BindHandler("GET:/api/media", ServeMedia)

	// tools / skills / memory / knowledge
	s.BindHandler("GET:/api/tools", GetTools)
	s.BindHandler("GET:/api/skills", GetSkills)
	s.BindHandler("POST:/api/skills", ToggleSkill)
	s.BindHandler("GET:/api/memory", GetMemory)
	s.BindHandler("GET:/api/memory/content", GetMemoryContent)
	s.BindHandler("GET:/api/knowledge/list", KnowledgeList)
	s.BindHandler("GET:/api/knowledge/read", KnowledgeRead)
	s.BindHandler("GET:/api/knowledge/graph", KnowledgeGraph)
	s.BindHandler("POST:/api/knowledge/action", KnowledgeAction)
	s.BindHandler("POST:/api/knowledge/import", KnowledgeImport)

	// channels
	s.BindHandler("GET:/api/channels", GetChannels)
	s.BindHandler("POST:/api/channels", ChannelsAction)
	s.BindHandler("GET:/api/weixin/qrlogin", WeixinQr)
	s.BindHandler("POST:/api/weixin/qrlogin", WeixinQr)
	s.BindHandler("GET:/api/feishu/register", FeishuRegister)
	s.BindHandler("POST:/api/feishu/register", FeishuRegister)

	// scheduler
	s.BindHandler("GET:/api/scheduler", GetScheduler)
	s.BindHandler("POST:/api/scheduler/run", SchedulerRun)
	s.BindHandler("POST:/api/scheduler/toggle", SchedulerToggle)
	s.BindHandler("POST:/api/scheduler/update", SchedulerUpdate)
	s.BindHandler("POST:/api/scheduler/delete", SchedulerDelete)

	// voice + logs
	s.BindHandler("POST:/api/voice/asr", VoiceAsr)
	s.BindHandler("POST:/api/voice/tts", VoiceTts)
	s.BindHandler("GET:/api/logs", LogsStream)
}
