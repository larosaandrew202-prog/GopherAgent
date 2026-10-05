package scheduler

import (
	"testing"
	"time"
)

func TestNextCron(t *testing.T) {
	// 2026-10-04 is a Sunday.
	base := time.Date(2026, 10, 4, 7, 30, 0, 0, time.Local)

	cases := []struct {
		expr string
		want time.Time
	}{
		{"0 8 * * *", time.Date(2026, 10, 4, 8, 0, 0, 0, time.Local)},
		{"*/15 * * * *", time.Date(2026, 10, 4, 7, 45, 0, 0, time.Local)},
		{"30 7 * * *", time.Date(2026, 10, 5, 7, 30, 0, 0, time.Local)},
		{"0 0 1 * *", time.Date(2026, 11, 1, 0, 0, 0, 0, time.Local)},
		{"0 9 * * 1", time.Date(2026, 10, 5, 9, 0, 0, 0, time.Local)},
	}
	for _, c := range cases {
		got, err := nextCron(c.expr, base)
		if err != nil {
			t.Fatalf("nextCron(%q): %v", c.expr, err)
		}
		if !got.Equal(c.want) {
			t.Errorf("nextCron(%q) = %v, want %v", c.expr, got, c.want)
		}
	}
}

func TestNextRun(t *testing.T) {
	base := time.Date(2026, 10, 4, 12, 0, 0, 0, time.Local)

	if got, _ := NextRun("interval", "60", base); got != base.Add(time.Minute).Unix() {
		t.Errorf("interval next = %d", got)
	}
	if got, _ := NextRun("once", "+30m", base); got != base.Add(30*time.Minute).Unix() {
		t.Errorf("once relative next = %d", got)
	}
	if _, err := NextRun("cron", "bad cron", base); err == nil {
		t.Error("expected error for bad cron")
	}
	if _, err := NextRun("interval", "-5", base); err == nil {
		t.Error("expected error for negative interval")
	}
}
