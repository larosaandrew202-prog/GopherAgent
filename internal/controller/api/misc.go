package api

import (
	"context"
	"os"
	"path/filepath"
	"strings"

	"github.com/gogf/gf/v2/frame/g"
	"github.com/gogf/gf/v2/net/ghttp"
	"github.com/gogf/gf/v2/util/gconv"

	"GopherAgent/internal/consts"
	configlogic "GopherAgent/internal/logic/config"
	memorylogic "GopherAgent/internal/logic/memory"
	"GopherAgent/internal/logic/paths"
	"GopherAgent/internal/logic/scheduler"
	"GopherAgent/internal/logic/schedulerrun"
	skillslogic "GopherAgent/internal/logic/skills"
	toolkit "GopherAgent/internal/logic/tools"
	"GopherAgent/internal/store"
)

// Health is an unauthenticated liveness probe.
func Health(r *ghttp.Request) {
	writeJSON(r, g.Map{"status": "ok"})
}

// Upload stores uploaded files and returns their paths.
func Upload(r *ghttp.Request) {
	if !requireAuth(r) {
		return
	}
	files := r.GetUploadFiles("files")
	if len(files) == 0 {
		if f := r.GetUploadFile("file"); f != nil {
			files = append(files, f)
		}
	}
	dir := store.DataPath(consts.DirUploads)
	out := make([]g.Map, 0, len(files))
	for _, f := range files {
		name, err := f.Save(dir, true)
		if err != nil {
			continue
		}
		out = append(out, g.Map{
			"file_name": f.Filename,
			"file_path": filepath.Join(dir, name),
			"file_type": detectFileType(f.Filename),
			"size":      f.Size,
		})
	}
	ok(r, g.Map{"files": out})
}

func detectFileType(name string) string {
	switch strings.ToLower(filepath.Ext(name)) {
	case ".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".svg":
		return "image"
	case ".mp4", ".mov", ".webm", ".mkv", ".avi":
		return "video"
	default:
		return "file"
	}
}

// OptimizePrompt is a lightweight placeholder that returns the input.
func OptimizePrompt(r *ghttp.Request) {
	if !requireAuth(r) {
		return
	}
	var body struct {
		Message string `json:"message"`
	}
	_ = parseBody(r, &body)
	optimized := body.Message
	ok(r, g.Map{"message": optimized, "optimized": optimized})
}

// GetTools returns the agent's tool catalogue.
func GetTools(r *ghttp.Request) {
	var disabled []string
	if list, isList := configlogic.C().Get(consts.CfgDisabledTools).([]interface{}); isList {
		for _, item := range list {
			if name, isStr := item.(string); isStr && name != "" {
				disabled = append(disabled, name)
			}
		}
	}
	registry := toolkit.Filtered(disabled)
	items := make([]g.Map, 0)
	for _, def := range registry.Definitions() {
		items = append(items, g.Map{
			"name":        def.Name,
			"label":       def.Name,
			"description": def.Description,
			"enabled":     true,
			"icon":        toolIcon(def.Name),
		})
	}
	ok(r, g.Map{"tools": items})
}

func toolIcon(name string) string {
	switch name {
	case consts.ToolBash:
		return "fa-terminal"
	case consts.ToolRead:
		return "fa-file-lines"
	case consts.ToolWrite:
		return "fa-file-pen"
	case consts.ToolEdit:
		return "fa-scissors"
	case consts.ToolLs:
		return "fa-folder-tree"
	case consts.ToolWebFetch, consts.ToolWebSearch:
		return "fa-globe"
	case consts.ToolMemorySearch, consts.ToolMemoryGet:
		return "fa-brain"
	case consts.ToolScheduler:
		return "fa-clock"
	case consts.ToolImageGen:
		return "fa-image"
	default:
		return "fa-wrench"
	}
}

// skillInfo is one entry in the console's skill catalogue.
type skillInfo struct {
	Name        string `json:"name"`
	Title       string `json:"title"`
	Description string `json:"description"`
	Path        string `json:"path"`
	Icon        string `json:"icon,omitempty"`
	Enabled     bool   `json:"enabled"`
}

// GetSkills lists the workspace skills and whether each is enabled.
func GetSkills(r *ghttp.Request) {
	if !requireAuth(r) {
		return
	}
	_ = skillslogic.EnsureGuide(paths.Workspace())
	disabled := skillslogic.Disabled()
	list := skillslogic.Load(paths.Workspace())
	items := make([]skillInfo, 0, len(list))
	for _, s := range list {
		items = append(items, skillInfo{
			Name:        s.Name,
			Title:       s.Name,
			Description: s.Description,
			Path:        s.Path,
			Icon:        s.Icon,
			Enabled:     !disabled[s.Name],
		})
	}
	ok(r, g.Map{"skills": items})
}

// ToggleSkill enables or disables one skill.
func ToggleSkill(r *ghttp.Request) {
	if !requireAuth(r) {
		return
	}
	var body struct {
		Name    string `json:"name"`
		Enabled bool   `json:"enabled"`
	}
	_ = parseBody(r, &body)
	name := strings.TrimSpace(body.Name)
	if name == "" {
		fail(r, "name is required")
		return
	}
	if err := skillslogic.SetEnabled(name, body.Enabled); err != nil {
		fail(r, err.Error())
		return
	}
	ok(r, g.Map{})
}

// GetMemory returns the long-term memory file listing.
func GetMemory(r *ghttp.Request) {
	if !requireAuth(r) {
		return
	}
	files := memorylogic.ListFiles()
	ok(r, g.Map{"list": files, "total": len(files), "page": 1, "page_size": len(files)})
}

// GetMemoryContent returns the content of one memory file.
func GetMemoryContent(r *ghttp.Request) {
	if !requireAuth(r) {
		return
	}
	filename := r.Get("filename").String()
	content, err := memorylogic.ReadFile(filename)
	if err != nil {
		fail(r, err.Error())
		return
	}
	ok(r, g.Map{"content": content, "filename": filename})
}

// KnowledgeList returns an empty knowledge tree.
func KnowledgeList(r *ghttp.Request) {
	ok(r, g.Map{"tree": []interface{}{}, "root_files": []interface{}{}, "stats": g.Map{}})
}

// KnowledgeRead returns empty knowledge content.
func KnowledgeRead(r *ghttp.Request) {
	ok(r, g.Map{"content": "", "path": r.Get("path").String(), "title": ""})
}

// KnowledgeGraph returns an empty graph.
func KnowledgeGraph(r *ghttp.Request) {
	ok(r, g.Map{"nodes": []interface{}{}, "links": []interface{}{}})
}

// KnowledgeAction acknowledges knowledge actions.
func KnowledgeAction(r *ghttp.Request) { ok(r, g.Map{}) }

// KnowledgeImport acknowledges imports.
func KnowledgeImport(r *ghttp.Request) { ok(r, g.Map{}) }

// GetChannels returns an empty channel listing.
func GetChannels(r *ghttp.Request) {
	ok(r, g.Map{"channels": []interface{}{}})
}

// ChannelsAction acknowledges channel actions.
func ChannelsAction(r *ghttp.Request) { ok(r, g.Map{}) }

// WeixinQr responds with a placeholder QR result.
func WeixinQr(r *ghttp.Request) {
	ok(r, g.Map{"login_status": "waiting", "qrcode": "", "qr_url": ""})
}

// FeishuRegister responds with a placeholder registration result.
func FeishuRegister(r *ghttp.Request) {
	ok(r, g.Map{"login_status": "waiting", "qrcode": ""})
}

// GetScheduler returns the persisted scheduled tasks.
func GetScheduler(r *ghttp.Request) {
	tasks, err := scheduler.List(r.Context())
	if err != nil {
		fail(r, err.Error())
		return
	}
	out := make([]g.Map, 0, len(tasks))
	for _, t := range tasks {
		out = append(out, schedulerTaskMap(t))
	}
	ok(r, g.Map{"tasks": out})
}

// SchedulerRun triggers a task immediately.
func SchedulerRun(r *ghttp.Request) {
	var body struct {
		TaskID string `json:"task_id"`
	}
	_ = parseBody(r, &body)
	task, found, err := scheduler.Get(r.Context(), body.TaskID)
	if err != nil {
		fail(r, err.Error())
		return
	}
	if !found {
		fail(r, "task not found")
		return
	}
	go schedulerrun.RunNow(context.Background(), *task)
	ok(r, g.Map{"message": body.TaskID})
}

// SchedulerToggle enables or disables a task.
func SchedulerToggle(r *ghttp.Request) {
	var body struct {
		TaskID  string `json:"task_id"`
		Enabled bool   `json:"enabled"`
	}
	_ = parseBody(r, &body)
	if err := scheduler.SetEnabled(r.Context(), body.TaskID, body.Enabled); err != nil {
		fail(r, err.Error())
		return
	}
	ok(r, g.Map{})
}

// SchedulerDelete removes a task.
func SchedulerDelete(r *ghttp.Request) {
	var body struct {
		TaskID string `json:"task_id"`
	}
	_ = parseBody(r, &body)
	if err := scheduler.Delete(r.Context(), body.TaskID); err != nil {
		fail(r, err.Error())
		return
	}
	ok(r, g.Map{})
}

// SchedulerUpdate creates or updates a task from the console editor.
func SchedulerUpdate(r *ghttp.Request) {
	body := r.GetMap()
	id := gconv.String(body["id"])
	if id == "" {
		id = gconv.String(body["task_id"])
	}
	schedule := gconv.Map(body["schedule"])
	action := gconv.Map(body["action"])
	scheduleType, scheduleValue := scheduleToParts(schedule, body)
	actionType, content := actionToParts(action, body)

	task := &scheduler.Task{
		ID:            id,
		Name:          gconv.String(body["name"]),
		ScheduleType:  scheduleType,
		ScheduleValue: scheduleValue,
		ActionType:    actionType,
		Content:       content,
		SessionID:     gconv.String(body["session_id"]),
	}
	if enabled, ok := body["enabled"]; ok {
		task.Enabled = gconv.Bool(enabled)
	} else {
		task.Enabled = true
	}

	if id != "" {
		if existing, found, _ := scheduler.Get(r.Context(), id); found {
			if task.SessionID == "" {
				task.SessionID = existing.SessionID
			}
			if err := scheduler.Update(r.Context(), task); err != nil {
				fail(r, err.Error())
				return
			}
			ok(r, g.Map{"task": schedulerTaskMap(*task)})
			return
		}
	}
	created, err := scheduler.Create(r.Context(), task)
	if err != nil {
		fail(r, err.Error())
		return
	}
	ok(r, g.Map{"task": schedulerTaskMap(*created)})
}

func schedulerTaskMap(t scheduler.Task) g.Map {
	schedule := g.Map{"type": t.ScheduleType}
	switch t.ScheduleType {
	case consts.ScheduleCron:
		schedule["expression"] = t.ScheduleValue
	case consts.ScheduleInterval:
		schedule["seconds"] = gconv.Int(t.ScheduleValue)
	case consts.ScheduleOnce:
		schedule["time"] = t.ScheduleValue
		if t.NextRunAt > 0 {
			schedule["run_at"] = t.NextRunAt * 1000
		}
	default:
		schedule["value"] = t.ScheduleValue
	}
	action := g.Map{"type": t.ActionType}
	if t.ActionType == consts.ActionAgentTask {
		action["task_description"] = t.Content
	} else {
		action["content"] = t.Content
	}
	// Timestamps are returned in milliseconds to match the console contract.
	return g.Map{
		"id":            t.ID,
		"name":          t.Name,
		"enabled":       t.Enabled,
		"next_run_at":   t.NextRunAt * 1000,
		"last_run_at":   t.LastRunAt * 1000,
		"last_result":   t.LastResult,
		"session_id":    t.SessionID,
		"schedule":      schedule,
		"action":        action,
		"schedule_text": scheduler.FormatSchedule(t.ScheduleType, t.ScheduleValue),
	}
}

func scheduleToParts(schedule g.Map, body g.Map) (string, string) {
	kind := gconv.String(schedule["type"])
	if kind == "" {
		kind = gconv.String(body["schedule_type"])
	}
	fallback := gconv.String(body["schedule_value"])
	var value string
	switch kind {
	case consts.ScheduleCron:
		value = firstNonEmpty(gconv.String(schedule["expression"]), fallback)
	case consts.ScheduleInterval:
		value = firstNonEmpty(gconv.String(schedule["seconds"]), fallback)
	case consts.ScheduleOnce:
		value = firstNonEmpty(gconv.String(schedule["time"]), gconv.String(schedule["value"]), fallback)
	default:
		value = firstNonEmpty(gconv.String(schedule["value"]), fallback)
	}
	return kind, value
}

func actionToParts(action g.Map, body g.Map) (string, string) {
	kind := gconv.String(action["type"])
	if kind == "" {
		kind = gconv.String(body["action_type"])
	}
	content := firstNonEmpty(gconv.String(action["content"]), gconv.String(body["message"]))
	taskDesc := firstNonEmpty(gconv.String(action["task_description"]), gconv.String(body["ai_task"]))
	if kind == consts.ActionAgentTask || (kind == "" && taskDesc != "" && content == "") {
		return consts.ActionAgentTask, firstNonEmpty(taskDesc, content)
	}
	if kind == "" {
		kind = consts.ActionSendMessage
	}
	return kind, firstNonEmpty(content, taskDesc)
}

// GetProjects returns an empty project listing.
func GetProjects(r *ghttp.Request) {
	ok(r, g.Map{
		"current":           nil,
		"recents":           []interface{}{},
		"default_workspace": "~/cow",
		"projects_root":     "",
		"projects":          []interface{}{},
	})
}

// SelectProject acknowledges project selection.
func SelectProject(r *ghttp.Request) { ok(r, g.Map{}) }

// CreateProject acknowledges project creation.
func CreateProject(r *ghttp.Request) { ok(r, g.Map{"path": ""}) }

// BrowseProjects returns an empty directory listing.
func BrowseProjects(r *ghttp.Request) {
	ok(r, g.Map{
		"path":    r.Get("path").String(),
		"entries": []interface{}{},
		"is_dir":  true,
		"drives":  []interface{}{},
	})
}

// ProjectAction acknowledges reorder/manage actions.
func ProjectAction(r *ghttp.Request) { ok(r, g.Map{}) }

// WorkspaceMeta returns default workspace metadata.
func WorkspaceMeta(r *ghttp.Request) {
	ok(r, g.Map{"root": "", "default_workspace": "~/cow", "projects_root": ""})
}

// WorkspaceTree returns an empty tree.
func WorkspaceTree(r *ghttp.Request) {
	ok(r, g.Map{"entries": []interface{}{}, "path": r.Get("path").String(), "root": ""})
}

// WorkspaceSearch returns no results.
func WorkspaceSearch(r *ghttp.Request) {
	ok(r, g.Map{"entries": []interface{}{}})
}

// WorkspaceResolve returns empty content.
func WorkspaceResolve(r *ghttp.Request) {
	ok(r, g.Map{"path": r.Get("path").String(), "content": ""})
}

// VoiceAsr reports that speech recognition is not configured.
func VoiceAsr(r *ghttp.Request) {
	fail(r, "speech recognition is not configured")
}

// VoiceTts reports that speech synthesis is not configured.
func VoiceTts(r *ghttp.Request) {
	fail(r, "text to speech is not configured")
}

// ServeFile serves a local file by absolute path (workspace preview/download).
func ServeFile(r *ghttp.Request) {
	if !requireAuth(r) {
		return
	}
	path := r.Get("path").String()
	if path == "" {
		r.Response.WriteStatus(400)
		return
	}
	info, err := os.Stat(path)
	if err != nil || info.IsDir() {
		r.Response.WriteStatus(404)
		return
	}
	r.Response.ServeFile(path)
}

// ServeMedia serves a generated media file confined to the agent workspace.
// Unlike ServeFile it rejects any path that escapes the workspace.
func ServeMedia(r *ghttp.Request) {
	if !requireAuth(r) {
		return
	}
	rel := strings.TrimSpace(r.Get("path").String())
	if rel == "" {
		r.Response.WriteStatus(400)
		return
	}
	ws := paths.Workspace()
	absWS, err := filepath.Abs(ws)
	if err != nil {
		r.Response.WriteStatus(500)
		return
	}
	absFull, err := filepath.Abs(filepath.Join(absWS, filepath.FromSlash(rel)))
	if err != nil {
		r.Response.WriteStatus(400)
		return
	}
	relCheck, err := filepath.Rel(absWS, absFull)
	if err != nil || relCheck == ".." || strings.HasPrefix(relCheck, ".."+string(filepath.Separator)) {
		r.Response.WriteStatus(403)
		return
	}
	info, err := os.Stat(absFull)
	if err != nil || info.IsDir() {
		r.Response.WriteStatus(404)
		return
	}
	r.Response.ServeFile(absFull)
}
