// Package paths resolves the agent workspace used for tools and long-term
// memory files.
package paths

import (
	"os"
	"path/filepath"
	"strings"

	"GopherAgent/internal/consts"
	configlogic "GopherAgent/internal/logic/config"
	"GopherAgent/internal/store"
)

// Workspace returns the absolute agent workspace directory. It defaults to a
// dedicated "workspace" folder under the data root so tool output and memory
// files never litter the project directory.
func Workspace() string {
	dir := strings.TrimSpace(configlogic.C().GetString(consts.CfgAgentWorkspace))
	if dir == "" {
		dir = filepath.Join(store.DataRoot(), "workspace")
	}
	if !filepath.IsAbs(dir) {
		if abs, err := filepath.Abs(dir); err == nil {
			dir = abs
		}
	}
	_ = os.MkdirAll(dir, 0o755)
	return dir
}
