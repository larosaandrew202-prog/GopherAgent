package tools

// Default is the process-wide registry of built-in tools.
var Default = buildDefault()

func buildDefault() *Registry {
	r := NewRegistry()
	r.Register(BashTool{})
	r.Register(ReadTool{})
	r.Register(WriteTool{})
	r.Register(EditTool{})
	r.Register(LsTool{})
	r.Register(WebFetchTool{})
	r.Register(WebSearchTool{})
	r.Register(MemorySearchTool{})
	r.Register(MemoryGetTool{})
	r.Register(SchedulerTool{})
	r.Register(ImageGenTool{})
	return r
}

// Filtered returns a registry without the named tools.
func Filtered(disabled []string) *Registry {
	if len(disabled) == 0 {
		return Default
	}
	blocked := make(map[string]struct{}, len(disabled))
	for _, name := range disabled {
		blocked[name] = struct{}{}
	}
	filtered := NewRegistry()
	for _, def := range Default.Definitions() {
		if _, skip := blocked[def.Name]; skip {
			continue
		}
		if tool, ok := Default.Get(def.Name); ok {
			filtered.Register(tool)
		}
	}
	return filtered
}
