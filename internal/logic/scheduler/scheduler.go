// Package scheduler implements persistent scheduled tasks and the schedule
// math (once / interval / cron) used by both the scheduler tool and the HTTP
// API. The background runner lives in the schedulerrun package.
package scheduler

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/gogf/gf/v2/database/gdb"
	"github.com/gogf/gf/v2/frame/g"

	"GopherAgent/internal/consts"
	"GopherAgent/internal/store"
)

// Task is a persisted scheduled task.
type Task struct {
	ID            string
	Name          string
	Enabled       bool
	ScheduleType  string // once | interval | cron
	ScheduleValue string
	ActionType    string // send_message | agent_task
	Content       string
	SessionID     string
	Silent        bool
	NextRunAt     int64
	LastRunAt     int64
	LastResult    string
	CreatedAt     int64
	UpdatedAt     int64
}

// NextRun computes the next run timestamp (unix seconds) for a schedule.
// A zero result means the task has no future run.
func NextRun(scheduleType, value string, from time.Time) (int64, error) {
	value = strings.TrimSpace(value)
	switch scheduleType {
	case consts.ScheduleOnce:
		t, err := parseOnce(value, from)
		if err != nil {
			return 0, err
		}
		return t.Unix(), nil
	case consts.ScheduleInterval:
		seconds, err := strconv.Atoi(value)
		if err != nil || seconds <= 0 {
			return 0, fmt.Errorf("interval must be a positive number of seconds")
		}
		return from.Add(time.Duration(seconds) * time.Second).Unix(), nil
	case consts.ScheduleCron:
		t, err := nextCron(value, from)
		if err != nil {
			return 0, err
		}
		return t.Unix(), nil
	default:
		return 0, fmt.Errorf("unknown schedule type %q (expected once/interval/cron)", scheduleType)
	}
}

func parseOnce(value string, from time.Time) (time.Time, error) {
	if strings.HasPrefix(value, "+") {
		v := value[1:]
		if len(v) < 2 {
			return time.Time{}, fmt.Errorf("invalid relative time %q", value)
		}
		amount, err := strconv.Atoi(v[:len(v)-1])
		if err != nil || amount < 0 {
			return time.Time{}, fmt.Errorf("invalid relative time %q", value)
		}
		switch v[len(v)-1] {
		case 's':
			return from.Add(time.Duration(amount) * time.Second), nil
		case 'm':
			return from.Add(time.Duration(amount) * time.Minute), nil
		case 'h':
			return from.Add(time.Duration(amount) * time.Hour), nil
		case 'd':
			return from.AddDate(0, 0, amount), nil
		default:
			return time.Time{}, fmt.Errorf("invalid relative unit in %q", value)
		}
	}
	for _, layout := range []string{time.RFC3339, "2006-01-02 15:04:05", "2006-01-02T15:04:05", "2006-01-02 15:04", "2006-01-02"} {
		if t, err := time.ParseInLocation(layout, value, time.Local); err == nil {
			return t, nil
		}
	}
	return time.Time{}, fmt.Errorf("invalid time %q", value)
}

// Create inserts a new task and computes its first run time.
func Create(ctx context.Context, task *Task) (*Task, error) {
	now := time.Now()
	if strings.TrimSpace(task.Name) == "" {
		return nil, fmt.Errorf("name is required")
	}
	if task.Content == "" {
		return nil, fmt.Errorf("message or ai_task is required")
	}
	if task.SessionID == "" {
		return nil, fmt.Errorf("session_id is required")
	}
	next, err := NextRun(task.ScheduleType, task.ScheduleValue, now)
	if err != nil {
		return nil, err
	}
	task.ID = randomID(8)
	task.Enabled = true
	task.CreatedAt = now.Unix()
	task.UpdatedAt = now.Unix()
	task.NextRunAt = next
	if task.ActionType == "" {
		task.ActionType = consts.ActionSendMessage
	}
	_, err = store.DB().Model(consts.TableScheduledTasks).Ctx(ctx).Data(g.Map{
		"id":             task.ID,
		"name":           task.Name,
		"enabled":        1,
		"schedule_type":  task.ScheduleType,
		"schedule_value": task.ScheduleValue,
		"action_type":    task.ActionType,
		"content":        task.Content,
		"session_id":     task.SessionID,
		"silent":         boolToInt(task.Silent),
		"next_run_at":    task.NextRunAt,
		"created_at":     task.CreatedAt,
		"updated_at":     task.UpdatedAt,
	}).Insert()
	if err != nil {
		return nil, err
	}
	return task, nil
}

// Update replaces the mutable fields of an existing task.
func Update(ctx context.Context, task *Task) error {
	if task.ID == "" {
		return fmt.Errorf("id is required")
	}
	if _, err := NextRun(task.ScheduleType, task.ScheduleValue, time.Now()); err != nil {
		return err
	}
	next, _ := NextRun(task.ScheduleType, task.ScheduleValue, time.Now())
	_, err := store.DB().Model(consts.TableScheduledTasks).Ctx(ctx).Where("id", task.ID).Data(g.Map{
		"name":           task.Name,
		"enabled":        boolToInt(task.Enabled),
		"schedule_type":  task.ScheduleType,
		"schedule_value": task.ScheduleValue,
		"action_type":    task.ActionType,
		"content":        task.Content,
		"session_id":     task.SessionID,
		"silent":         boolToInt(task.Silent),
		"next_run_at":    next,
		"updated_at":     time.Now().Unix(),
	}).Update()
	return err
}

// Get loads a task by id.
func Get(ctx context.Context, id string) (*Task, bool, error) {
	row, err := store.DB().Model(consts.TableScheduledTasks).Ctx(ctx).Where("id", id).One()
	if err != nil {
		return nil, false, err
	}
	if row.IsEmpty() {
		return nil, false, nil
	}
	return recordToTask(row), true, nil
}

// List returns all tasks, newest first.
func List(ctx context.Context) ([]Task, error) {
	rows, err := store.DB().Model(consts.TableScheduledTasks).Ctx(ctx).OrderDesc("created_at").All()
	if err != nil {
		return nil, err
	}
	out := make([]Task, 0, len(rows))
	for _, row := range rows {
		out = append(out, *recordToTask(row))
	}
	return out, nil
}

// Delete removes a task.
func Delete(ctx context.Context, id string) error {
	_, err := store.DB().Model(consts.TableScheduledTasks).Ctx(ctx).Where("id", id).Delete()
	return err
}

// SetEnabled toggles a task.
func SetEnabled(ctx context.Context, id string, enabled bool) error {
	_, err := store.DB().Model(consts.TableScheduledTasks).Ctx(ctx).Where("id", id).Data(g.Map{
		"enabled":    boolToInt(enabled),
		"updated_at": time.Now().Unix(),
	}).Update()
	return err
}

// Due returns enabled tasks whose next run time is at or before now.
func Due(ctx context.Context, now time.Time) ([]Task, error) {
	rows, err := store.DB().Model(consts.TableScheduledTasks).Ctx(ctx).
		Where("enabled", 1).
		Where("next_run_at > ?", 0).
		Where("next_run_at <= ?", now.Unix()).
		OrderAsc("next_run_at").
		All()
	if err != nil {
		return nil, err
	}
	out := make([]Task, 0, len(rows))
	for _, row := range rows {
		out = append(out, *recordToTask(row))
	}
	return out, nil
}

// MarkRun records the outcome of a run and schedules the next one.
func MarkRun(ctx context.Context, id, result string, nextRunAt int64, disable bool) error {
	data := g.Map{
		"last_run_at": time.Now().Unix(),
		"last_result": result,
		"next_run_at": nextRunAt,
		"updated_at":  time.Now().Unix(),
	}
	if disable {
		data["enabled"] = 0
	}
	_, err := store.DB().Model(consts.TableScheduledTasks).Ctx(ctx).Where("id", id).Data(data).Update()
	return err
}

// FormatSchedule renders a human-readable schedule description.
func FormatSchedule(scheduleType, value string) string {
	switch scheduleType {
	case consts.ScheduleCron:
		return "Cron: " + value
	case consts.ScheduleInterval:
		if seconds, err := strconv.Atoi(value); err == nil {
			switch {
			case seconds >= 86400:
				return fmt.Sprintf("每 %d 天", seconds/86400)
			case seconds >= 3600:
				return fmt.Sprintf("每 %d 小时", seconds/3600)
			case seconds >= 60:
				return fmt.Sprintf("每 %d 分钟", seconds/60)
			default:
				return fmt.Sprintf("每 %d 秒", seconds)
			}
		}
		return "间隔 " + value + " 秒"
	case consts.ScheduleOnce:
		return "一次性 (" + value + ")"
	default:
		return scheduleType + " " + value
	}
}

func recordToTask(row gdb.Record) *Task {
	return &Task{
		ID:            row["id"].String(),
		Name:          row["name"].String(),
		Enabled:       row["enabled"].Bool(),
		ScheduleType:  row["schedule_type"].String(),
		ScheduleValue: row["schedule_value"].String(),
		ActionType:    row["action_type"].String(),
		Content:       row["content"].String(),
		SessionID:     row["session_id"].String(),
		Silent:        row["silent"].Bool(),
		NextRunAt:     row["next_run_at"].Int64(),
		LastRunAt:     row["last_run_at"].Int64(),
		LastResult:    row["last_result"].String(),
		CreatedAt:     row["created_at"].Int64(),
		UpdatedAt:     row["updated_at"].Int64(),
	}
}

func boolToInt(v bool) int {
	if v {
		return 1
	}
	return 0
}

func randomID(n int) string {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		return fmt.Sprintf("task%d", time.Now().UnixNano())
	}
	return hex.EncodeToString(b)[:n]
}
