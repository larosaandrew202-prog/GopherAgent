package skills

import (
	"sort"

	"GopherAgent/internal/consts"
	configlogic "GopherAgent/internal/logic/config"
)

// Disabled returns the set of skill names turned off in configuration.
func Disabled() map[string]bool {
	list, ok := configlogic.C().Get(consts.CfgDisabledSkills).([]interface{})
	if !ok {
		return map[string]bool{}
	}
	out := make(map[string]bool, len(list))
	for _, item := range list {
		if name, ok := item.(string); ok && name != "" {
			out[name] = true
		}
	}
	return out
}

// SetEnabled turns one skill on or off and persists the change.
func SetEnabled(name string, enabled bool) error {
	set := Disabled()
	if enabled {
		delete(set, name)
	} else {
		set[name] = true
	}
	names := make([]string, 0, len(set))
	for n := range set {
		names = append(names, n)
	}
	sort.Strings(names)
	values := make([]interface{}, len(names))
	for i, n := range names {
		values[i] = n
	}
	configlogic.C().Set(consts.CfgDisabledSkills, values)
	return configlogic.C().Save()
}
