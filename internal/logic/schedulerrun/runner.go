// Package schedulerrun is the background worker that executes due scheduled
// tasks. It lives in its own package so the scheduler store stays free of any
// dependency on the chat/agent layer.
package schedulerrun

import (
	"context"
	"time"

	"github.com/gogf/gf/v2/frame/g"

	"GopherAgent/internal/consts"
	chatlogic "GopherAgent/internal/logic/chat"
	"GopherAgent/internal/logic/scheduler"
)

const tickInterval = 10 * time.Second

// Start launches the scheduler worker. It returns immediately.
func Start(ctx context.Context) {
	go func() {
		ticker := time.NewTicker(tickInterval)
		defer ticker.Stop()
		runDue(ctx)
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				runDue(ctx)
			}
		}
	}()
	g.Log().Info(ctx, "scheduler worker started")
}

func runDue(ctx context.Context) {
	tasks, err := scheduler.Due(ctx, time.Now())
	if err != nil {
		g.Log().Errorf(ctx, "scheduler: failed to load due tasks: %v", err)
		return
	}
	for _, task := range tasks {
		runTask(ctx, task)
	}
}

// RunNow executes a task immediately (used by the console "run" button).
func RunNow(ctx context.Context, task scheduler.Task) {
	runTask(ctx, task)
}

func runTask(ctx context.Context, task scheduler.Task) {
	runCtx, cancel := context.WithTimeout(ctx, 5*time.Minute)
	defer cancel()

	result := ""
	var err error
	if task.ActionType == consts.ActionAgentTask {
		result, err = chatlogic.RunTask(runCtx, task.SessionID, task.Content)
	} else {
		_, _ = chatlogic.EnsureSession(runCtx, task.SessionID)
		_, err = chatlogic.AppendMessage(runCtx, task.SessionID, consts.RoleAssistant, task.Content, "")
		if err == nil {
			result = task.Content
		}
	}

	next := int64(0)
	disable := false
	if task.ScheduleType == consts.ScheduleOnce {
		disable = true
	} else {
		next, _ = scheduler.NextRun(task.ScheduleType, task.ScheduleValue, time.Now())
	}

	if err != nil {
		result = "error: " + err.Error()
	}
	if task.Silent && task.ActionType == consts.ActionAgentTask {
		result = "(silent)"
	}
	if markErr := scheduler.MarkRun(context.Background(), task.ID, result, next, disable); markErr != nil {
		g.Log().Errorf(ctx, "scheduler: failed to mark task %s: %v", task.ID, markErr)
	}
	g.Log().Infof(ctx, "scheduler: ran task %s (%s)", task.ID, task.Name)
}
