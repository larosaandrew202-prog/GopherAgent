package scheduler

import (
	"fmt"
	"strconv"
	"strings"
	"time"
)

// nextCron returns the first time at or after from that matches a standard
// 5-field cron expression (minute hour day-of-month month day-of-week).
// It supports '*', 'a', 'a-b', 'a-b/n', '*/n' and comma-separated lists.
func nextCron(expr string, from time.Time) (time.Time, error) {
	fields := strings.Fields(strings.TrimSpace(expr))
	if len(fields) != 5 {
		return time.Time{}, fmt.Errorf("cron expression must have 5 fields, got %d", len(fields))
	}
	minute, _, err := expandField(fields[0], 0, 59)
	if err != nil {
		return time.Time{}, fmt.Errorf("minute: %w", err)
	}
	hour, _, err := expandField(fields[1], 0, 23)
	if err != nil {
		return time.Time{}, fmt.Errorf("hour: %w", err)
	}
	dom, domAny, err := expandField(fields[2], 1, 31)
	if err != nil {
		return time.Time{}, fmt.Errorf("day-of-month: %w", err)
	}
	month, _, err := expandField(fields[3], 1, 12)
	if err != nil {
		return time.Time{}, fmt.Errorf("month: %w", err)
	}
	dow, dowAny, err := expandField(fields[4], 0, 7)
	if err != nil {
		return time.Time{}, fmt.Errorf("day-of-week: %w", err)
	}

	// Iterate minute by minute, capped at ~4 years.
	start := from.Truncate(time.Minute).Add(time.Minute)
	limit := start.AddDate(4, 0, 0)
	for t := start; t.Before(limit); t = t.Add(time.Minute) {
		if !minute[t.Minute()] || !hour[t.Hour()] || !month[int(t.Month())] {
			continue
		}
		domMatch := dom[t.Day()]
		weekday := int(t.Weekday()) % 7
		dowMatch := dow[weekday] || dow[7] && weekday == 0
		switch {
		case domAny && dowAny:
			// no day restriction
		case domAny:
			if !dowMatch {
				continue
			}
		case dowAny:
			if !domMatch {
				continue
			}
		default:
			// Both restricted: cron semantics allow either to match.
			if !domMatch && !dowMatch {
				continue
			}
		}
		return t, nil
	}
	return time.Time{}, fmt.Errorf("no matching time found for cron %q within 4 years", expr)
}

// expandField parses one cron field into the set of matching values.
func expandField(field string, min, max int) (map[int]bool, bool, error) {
	out := map[int]bool{}
	if field == "" {
		return nil, false, fmt.Errorf("empty field")
	}
	any := false
	for _, part := range strings.Split(field, ",") {
		part = strings.TrimSpace(part)
		if part == "" {
			continue
		}
		step := 1
		if idx := strings.Index(part, "/"); idx >= 0 {
			s, err := strconv.Atoi(part[idx+1:])
			if err != nil || s <= 0 {
				return nil, false, fmt.Errorf("invalid step %q", part)
			}
			step = s
			part = part[:idx]
		}

		var lo, hi int
		switch {
		case part == "*":
			lo, hi, any = min, max, true
		case strings.Contains(part, "-"):
			bounds := strings.SplitN(part, "-", 2)
			a, err1 := strconv.Atoi(strings.TrimSpace(bounds[0]))
			b, err2 := strconv.Atoi(strings.TrimSpace(bounds[1]))
			if err1 != nil || err2 != nil {
				return nil, false, fmt.Errorf("invalid range %q", part)
			}
			lo, hi = a, b
		default:
			v, err := strconv.Atoi(part)
			if err != nil {
				return nil, false, fmt.Errorf("invalid value %q", part)
			}
			lo, hi = v, v
			if step != 1 {
				// "a/n" means from a to the field maximum.
				hi = max
			}
		}
		for v := lo; v <= hi; v += step {
			if v >= min && v <= max {
				out[v] = true
			}
		}
	}
	if len(out) == 0 {
		return nil, false, fmt.Errorf("field %q matches no values", field)
	}
	return out, any, nil
}
