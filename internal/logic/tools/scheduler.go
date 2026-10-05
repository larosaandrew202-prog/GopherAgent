package tools

import (
	"context"
	"fmt"
	"strings"
	"time"

	"GopherAgent/internal/consts"
	"GopherAgent/internal/logic/scheduler"
)

// SchedulerTool creates and manages scheduled tasks (reminders, recurring
// jobs). It shares the persistent task store with the console Tasks view.
type SchedulerTool struct{}

func (SchedulerTool) Name() string { return consts.ToolScheduler }

func (SchedulerTool) Description() string {
	return "创建、查询和管理定时任务（提醒、周期性任务等）。\n" +
		"仅当需要「定时/提醒/每天/每周/X分钟后/X点」等延迟或周期执行时使用。\n" +
		"- 创建：action='create', name='任务名', message 或 ai_task, schedule_type, schedule_value\n" +
		"- 查询：action='list' / action='get', task_id\n" +
		"- 管理：action='delete|enable|disable', task_id\n" +
		"调度类型：once(相对时间 +5s/+10m/+1h/+1d 或 ISO 时间)、interval(间隔秒数)、cron(cron 表达式)。"
}

func (SchedulerTool) Parameters() map[string]interface{} {
	return map[string]interface{}{
		"type": "object",
		"properties": map[string]interface{}{
			"action": map[string]interface{}{
				"type": "string",
				"enum": []string{
					consts.ToolActionCreate, consts.ToolActionList, consts.ToolActionGet,
					consts.ToolActionDelete, consts.ToolActionEnable, consts.ToolActionDisable,
				},
				"description": "操作类型。",
			},
			"task_id":        map[string]interface{}{"type": "string", "description": "任务 ID（get/delete/enable/disable 使用）。"},
			"name":           map[string]interface{}{"type": "string", "description": "任务名称（create 使用）。"},
			"message":        map[string]interface{}{"type": "string", "description": "固定消息内容（与 ai_task 二选一）。"},
			"ai_task":        map[string]interface{}{"type": "string", "description": "到点后由 Agent 执行的任务描述（与 message 二选一）。"},
			"schedule_type":  map[string]interface{}{"type": "string", "enum": []string{consts.ScheduleOnce, consts.ScheduleInterval, consts.ScheduleCron}, "description": "调度类型。"},
			"schedule_value": map[string]interface{}{"type": "string", "description": "调度值：cron 表达式 / 间隔秒数 / 时间(+5s,+10m 或 ISO)。"},
			"silent":         map[string]interface{}{"type": "boolean", "description": "仅 ai_task：执行后不推送结果。"},
		},
		"required": []string{"action"},
	}
}

func (SchedulerTool) Execute(ctx context.Context, args map[string]interface{}, ec ExecContext) (string, error) {
	switch strings.ToLower(strings.TrimSpace(strArg(args, "action"))) {
	case consts.ToolActionCreate:
		return schedulerCreate(ctx, args, ec)
	case consts.ToolActionList:
		return schedulerList(ctx)
	case consts.ToolActionGet:
		return schedulerGet(ctx, strArg(args, "task_id"))
	case consts.ToolActionDelete:
		return schedulerDelete(ctx, strArg(args, "task_id"))
	case consts.ToolActionEnable:
		return schedulerToggle(ctx, strArg(args, "task_id"), true)
	case consts.ToolActionDisable:
		return schedulerToggle(ctx, strArg(args, "task_id"), false)
	default:
		return "", fmt.Errorf("unknown action: %s", strArg(args, "action"))
	}
}

func schedulerCreate(ctx context.Context, args map[string]interface{}, ec ExecContext) (string, error) {
	name := strings.TrimSpace(strArg(args, "name"))
	if name == "" {
		return "", fmt.Errorf("缺少任务名称 (name)")
	}
	message := strings.TrimSpace(strArg(args, "message"))
	aiTask := strings.TrimSpace(strArg(args, "ai_task"))
	if message == "" && aiTask == "" {
		return "", fmt.Errorf("必须提供 message（固定消息）或 ai_task（AI 任务）之一")
	}
	if message != "" && aiTask != "" {
		return "", fmt.Errorf("message 和 ai_task 只能提供其中一个")
	}
	scheduleType := strings.ToLower(strings.TrimSpace(strArg(args, "schedule_type")))
	scheduleValue := strings.TrimSpace(strArg(args, "schedule_value"))
	if scheduleType == "" || scheduleValue == "" {
		return "", fmt.Errorf("缺少 schedule_type 或 schedule_value")
	}
	silent := boolArg(args, "silent")

	task := &scheduler.Task{
		Name:          name,
		ScheduleType:  scheduleType,
		ScheduleValue: scheduleValue,
		SessionID:     ec.SessionID,
		Silent:        silent,
	}
	if message != "" {
		task.ActionType = consts.ActionSendMessage
		task.Content = message
	} else {
		task.ActionType = consts.ActionAgentTask
		task.Content = aiTask
	}

	created, err := scheduler.Create(ctx, task)
	if err != nil {
		return "", err
	}
	next := "未知"
	if created.NextRunAt > 0 {
		next = time.Unix(created.NextRunAt, 0).Format("2006-01-02 15:04:05")
	}
	return fmt.Sprintf("✅ 定时任务创建成功\n\n📋 任务ID: %s\n📝 名称: %s\n⏰ 调度: %s\n内容: %s\n🕐 下次执行: %s",
		created.ID, created.Name, scheduler.FormatSchedule(created.ScheduleType, created.ScheduleValue),
		truncateTask(created.Content), next), nil
}

func schedulerList(ctx context.Context) (string, error) {
	tasks, err := scheduler.List(ctx)
	if err != nil {
		return "", err
	}
	if len(tasks) == 0 {
		return "📋 暂无定时任务", nil
	}
	var b strings.Builder
	fmt.Fprintf(&b, "📋 定时任务列表 (共 %d 个)", len(tasks))
	for _, t := range tasks {
		status := "✅"
		if !t.Enabled {
			status = "❌"
		}
		next := "未知"
		if t.NextRunAt > 0 {
			next = time.Unix(t.NextRunAt, 0).Format("01-02 15:04")
		}
		fmt.Fprintf(&b, "\n%s [%s] %s\n   ⏰ %s | 下次: %s", status, t.ID, t.Name,
			scheduler.FormatSchedule(t.ScheduleType, t.ScheduleValue), next)
	}
	return b.String(), nil
}

func schedulerGet(ctx context.Context, id string) (string, error) {
	if id == "" {
		return "", fmt.Errorf("缺少任务ID (task_id)")
	}
	task, ok, err := scheduler.Get(ctx, id)
	if err != nil {
		return "", err
	}
	if !ok {
		return "", fmt.Errorf("任务 %q 不存在", id)
	}
	status := "启用"
	if !task.Enabled {
		status = "禁用"
	}
	next := "未知"
	if task.NextRunAt > 0 {
		next = time.Unix(task.NextRunAt, 0).Format("2006-01-02 15:04:05")
	}
	last := "从未执行"
	if task.LastRunAt > 0 {
		last = time.Unix(task.LastRunAt, 0).Format("2006-01-02 15:04:05")
	}
	return fmt.Sprintf("📋 任务详情\n\nID: %s\n名称: %s\n状态: %s\n调度: %s\n内容: %s\n下次执行: %s\n上次执行: %s",
		task.ID, task.Name, status, scheduler.FormatSchedule(task.ScheduleType, task.ScheduleValue),
		task.Content, next, last), nil
}

func schedulerDelete(ctx context.Context, id string) (string, error) {
	if id == "" {
		return "", fmt.Errorf("缺少任务ID (task_id)")
	}
	task, ok, err := scheduler.Get(ctx, id)
	if err != nil {
		return "", err
	}
	if !ok {
		return "", fmt.Errorf("任务 %q 不存在", id)
	}
	if err := scheduler.Delete(ctx, id); err != nil {
		return "", err
	}
	return fmt.Sprintf("✅ 任务 '%s' (%s) 已删除", task.Name, id), nil
}

func schedulerToggle(ctx context.Context, id string, enabled bool) (string, error) {
	if id == "" {
		return "", fmt.Errorf("缺少任务ID (task_id)")
	}
	task, ok, err := scheduler.Get(ctx, id)
	if err != nil {
		return "", err
	}
	if !ok {
		return "", fmt.Errorf("任务 %q 不存在", id)
	}
	if err := scheduler.SetEnabled(ctx, id, enabled); err != nil {
		return "", err
	}
	if enabled {
		return fmt.Sprintf("✅ 任务 '%s' (%s) 已启用", task.Name, id), nil
	}
	return fmt.Sprintf("✅ 任务 '%s' (%s) 已禁用", task.Name, id), nil
}

func truncateTask(s string) string {
	if len(s) > 80 {
		return s[:80] + "..."
	}
	return s
}
