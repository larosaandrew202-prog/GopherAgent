// Package skills implements file-based agent skills, ported from CowAgent.
//
// A skill is a directory under <workspace>/skills that contains a SKILL.md
// file:
//
//	---
//	name: image-gen
//	description: Generate an image from a text prompt and save it.
//	icon: 🎨
//	---
//	# Image Gen
//	1. Call the image_gen tool with the user's prompt.
//	2. Report the saved path.
//
// Skills are NOT tools. The model is told which skills exist and where each
// SKILL.md lives; to use one it reads the file with the `read` tool and follows
// the instructions in it (usually by running bundled scripts via `bash`). This
// keeps arbitrary capabilities out of the tool schema.
package skills

import (
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

// Subdir is the skills directory under the agent workspace.
const Subdir = "skills"

// Skill is one discovered skill.
type Skill struct {
	Name        string // from frontmatter, or the directory name
	Description string // what it does / when to use it (the model routes on this)
	Path        string // absolute path to SKILL.md
	BaseDir     string // absolute directory containing SKILL.md
	Icon        string // optional emoji/icon for the console
}

// Dir returns the skills directory for a workspace.
func Dir(workspace string) string {
	return filepath.Join(workspace, Subdir)
}

// Load discovers skills under <workspace>/skills. Every file named SKILL.md
// (case-insensitive) defines one skill at its own directory. Results are sorted
// by name. A missing directory yields no skills and no error.
func Load(workspace string) []Skill {
	root := Dir(workspace)
	var out []Skill
	_ = filepath.WalkDir(root, func(path string, d fs.DirEntry, err error) error {
		if err != nil || d == nil || d.IsDir() {
			return nil
		}
		if !strings.EqualFold(d.Name(), "SKILL.md") {
			return nil
		}
		data, readErr := os.ReadFile(path)
		if readErr != nil {
			return nil
		}
		fm := parseFrontmatter(string(data))
		name := firstNonEmpty(fm["name"], filepath.Base(filepath.Dir(path)))
		out = append(out, Skill{
			Name:        name,
			Description: strings.TrimSpace(fm["description"]),
			Path:        path,
			BaseDir:     filepath.Dir(path),
			Icon:        firstNonEmpty(fm["icon"], fm["emoji"]),
		})
		return nil
	})
	sort.Slice(out, func(i, j int) bool { return out[i].Name < out[j].Name })
	return out
}

// Enabled filters skills down to those whose name is not in disabled.
func Enabled(list []Skill, disabled map[string]bool) []Skill {
	if len(disabled) == 0 {
		return list
	}
	out := make([]Skill, 0, len(list))
	for _, s := range list {
		if !disabled[s.Name] {
			out = append(out, s)
		}
	}
	return out
}

// Prompt renders the skills as the system-prompt block the model routes on.
// It returns "" when there are no skills.
func Prompt(list []Skill) string {
	if len(list) == 0 {
		return ""
	}
	var b strings.Builder
	b.WriteString("# Skills\n\n")
	b.WriteString("A skill is NOT a tool and cannot be called directly. To use one, read its " +
		"SKILL.md with the `read` tool, then follow the instructions in that file " +
		"(running any bundled scripts through `bash`). Use a skill when its description " +
		"matches what the user asked for.\n\n")
	b.WriteString("<available_skills>\n")
	for _, s := range list {
		b.WriteString("  <skill>\n")
		fmt.Fprintf(&b, "    <name>%s</name>\n", xmlEscape(s.Name))
		fmt.Fprintf(&b, "    <description>%s</description>\n", xmlEscape(s.Description))
		fmt.Fprintf(&b, "    <location>%s</location>\n", xmlEscape(s.Path))
		fmt.Fprintf(&b, "    <base_dir>%s</base_dir>\n", xmlEscape(s.BaseDir))
		b.WriteString("  </skill>\n")
	}
	b.WriteString("</available_skills>\n")
	return b.String()
}

// EnsureGuide creates the skills directory and a README explaining the format,
// so a fresh workspace documents how to add one. It never overwrites.
func EnsureGuide(workspace string) error {
	dir := Dir(workspace)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	guide := filepath.Join(dir, "README.md")
	if _, err := os.Stat(guide); err == nil {
		return nil
	}
	return os.WriteFile(guide, []byte(guideContent), 0o644)
}

const guideContent = "# Skills\n\n" +
	"Each subdirectory here is a skill the agent can use. A skill is a `SKILL.md`\n" +
	"file (with optional frontmatter) plus any scripts or resources it needs:\n\n" +
	"```\n" +
	"skills/\n" +
	"  my-skill/\n" +
	"    SKILL.md          # required\n" +
	"    scripts/          # optional, run via the bash tool\n" +
	"    resources/        # optional reference files\n" +
	"```\n\n" +
	"`SKILL.md` frontmatter:\n\n" +
	"```markdown\n" +
	"---\n" +
	"name: my-skill\n" +
	"description: One sentence on when to use this skill (the agent routes on it).\n" +
	"icon: 🔧\n" +
	"---\n\n" +
	"# My Skill\n\n" +
	"Step-by-step instructions the agent should follow...\n" +
	"```\n\n" +
	"The agent does not get a tool per skill. It reads this file with the `read`\n" +
	"tool and follows the instructions, running any scripts with `bash`.\n"

// parseFrontmatter reads top-level `key: value` pairs from a leading
// `---\n...\n---` block. Values may be quoted; nested maps/lists are ignored.
func parseFrontmatter(content string) map[string]string {
	fm := map[string]string{}
	lines := strings.Split(content, "\n")
	if len(lines) == 0 || strings.TrimSpace(lines[0]) != "---" {
		return fm
	}
	for i := 1; i < len(lines); i++ {
		line := lines[i]
		if strings.TrimSpace(line) == "---" {
			break
		}
		// Skip blanks and indented (nested) lines.
		if line == "" || line[0] == ' ' || line[0] == '\t' {
			continue
		}
		idx := strings.Index(line, ":")
		if idx < 0 {
			continue
		}
		key := strings.TrimSpace(line[:idx])
		val := strings.Trim(strings.TrimSpace(line[idx+1:]), `"'`)
		if key != "" {
			fm[key] = val
		}
	}
	return fm
}

func firstNonEmpty(values ...string) string {
	for _, v := range values {
		if strings.TrimSpace(v) != "" {
			return strings.TrimSpace(v)
		}
	}
	return ""
}

func xmlEscape(s string) string {
	r := strings.NewReplacer("&", "&amp;", "<", "&lt;", ">", "&gt;", `"`, "&quot;")
	return r.Replace(s)
}
