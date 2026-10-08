package api

import "github.com/gogf/gf/v2/net/ghttp"

// Register binds every console-facing route onto the server, grouped by domain.
// Each group owns its prefix, so a path segment is written once instead of on
// every route.
func Register(s *ghttp.Server) {
	registerRoot(s)
	registerAPI(s)
}

// registerRoot binds the endpoints that live at the server root rather than
// under /api: auth, config and the chat transport.
func registerRoot(s *ghttp.Server) {
	s.Group("/auth", func(auth *ghttp.RouterGroup) {
		auth.GET("/check", AuthCheck)
		auth.POST("/login", AuthLogin)
		auth.POST("/logout", AuthLogout)
	})

	s.Group("/config", func(cfg *ghttp.RouterGroup) {
		cfg.GET("/", GetConfig)
		cfg.POST("/", SaveConfig)
	})

	s.Group("", func(chat *ghttp.RouterGroup) {
		chat.POST("/message", PostMessage)
		chat.GET("/stream", StreamChat)
		chat.POST("/cancel", CancelChat)
		chat.POST("/upload", Upload)
	})
}

// registerAPI binds everything under /api.
func registerAPI(s *ghttp.Server) {
	s.Group("/api", func(api *ghttp.RouterGroup) {
		// meta + config + models
		api.GET("/version", Version)
		api.GET("/health", Health)
		api.GET("/models", GetModels)
		api.POST("/models", ModelsAction)
		api.POST("/prompt/optimize", OptimizePrompt)

		// sessions (specific paths before the generic {id})
		api.Group("/sessions", func(sessions *ghttp.RouterGroup) {
			sessions.POST("/{id}/clear_context", ClearContext)
			sessions.POST("/{id}/generate_title", GenerateTitle)
			sessions.GET("/{id}/settings", GetSessionSettings)
			sessions.POST("/{id}/settings", UpdateSessionSettings)
			sessions.GET("/", ListSessions)
			sessions.GET("/{id}", GetSession)
			sessions.PUT("/{id}", UpdateSession)
			sessions.DELETE("/{id}", DeleteSession)
		})
		api.GET("/history", History)
		api.POST("/messages/delete", DeleteMessagesHandler)

		// projects + workspace
		api.Group("/projects", func(projects *ghttp.RouterGroup) {
			projects.GET("/", GetProjects)
			projects.POST("/select", SelectProject)
			projects.POST("/create", CreateProject)
			projects.GET("/browse", BrowseProjects)
			projects.POST("/order", ProjectAction)
			projects.POST("/manage", ProjectAction)
		})
		api.Group("/workspace", func(ws *ghttp.RouterGroup) {
			ws.GET("/meta", WorkspaceMeta)
			ws.GET("/tree", WorkspaceTree)
			ws.GET("/search", WorkspaceSearch)
			ws.GET("/resolve", WorkspaceResolve)
		})
		api.GET("/file", ServeFile)
		api.GET("/media", ServeMedia)

		// tools / skills / memory / knowledge
		api.GET("/tools", GetTools)
		api.Group("/skills", func(skills *ghttp.RouterGroup) {
			skills.GET("/", GetSkills)
			skills.POST("/", ToggleSkill)
		})
		api.Group("/memory", func(mem *ghttp.RouterGroup) {
			mem.GET("/", GetMemory)
			mem.GET("/content", GetMemoryContent)
		})
		api.Group("/knowledge", func(knowledge *ghttp.RouterGroup) {
			knowledge.GET("/list", KnowledgeList)
			knowledge.GET("/read", KnowledgeRead)
			knowledge.GET("/graph", KnowledgeGraph)
			knowledge.POST("/action", KnowledgeAction)
			knowledge.POST("/import", KnowledgeImport)
		})

		// channels
		api.Group("/channels", func(channels *ghttp.RouterGroup) {
			channels.GET("/", GetChannels)
			channels.POST("/", ChannelsAction)
		})
		api.GET("/weixin/qrlogin", WeixinQr)
		api.POST("/weixin/qrlogin", WeixinQr)
		api.GET("/feishu/register", FeishuRegister)
		api.POST("/feishu/register", FeishuRegister)

		// scheduler
		api.Group("/scheduler", func(scheduler *ghttp.RouterGroup) {
			scheduler.GET("/", GetScheduler)
			scheduler.POST("/run", SchedulerRun)
			scheduler.POST("/toggle", SchedulerToggle)
			scheduler.POST("/update", SchedulerUpdate)
			scheduler.POST("/delete", SchedulerDelete)
		})

		// voice + logs
		api.Group("/voice", func(voice *ghttp.RouterGroup) {
			voice.POST("/asr", VoiceAsr)
			voice.POST("/tts", VoiceTts)
		})
		api.Group("/logs", func(logs *ghttp.RouterGroup) {
			logs.GET("/", LogsStream)
			logs.GET("/download", LogsDownload)
		})
	})
}
