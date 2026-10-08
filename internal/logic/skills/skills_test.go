package skills

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func writeSkill(t *testing.T, root, dir, content string) {
	t.Helper()
	d := filepath.Join(root, Subdir, dir)
	if err := os.MkdirAll(d, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(d, "SKILL.md"), []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
}

func TestLoadAndPrompt(t *testing.T) {
	ws := t.TempDir()
	writeSkill(t, ws, "b-skill", "---\nname: image-gen\ndescription: Generate an image.\nicon: 🎨\n---\n# hi\n")
	writeSkill(t, ws, "a-skill", "# no frontmatter\n")

	list := Load(ws)
	if len(list) != 2 {
		t.Fatalf("got %d skills, want 2", len(list))
	}
	// Sorted by name: "a-skill" before "image-gen".
	if list[0].Name != "a-skill" || list[1].Name != "image-gen" {
		t.Fatalf("order = %q,%q", list[0].Name, list[1].Name)
	}
	img := list[1]
	if img.Description != "Generate an image." || img.Icon != "🎨" {
		t.Fatalf("frontmatter not parsed: %+v", img)
	}
	if img.BaseDir != filepath.Join(ws, Subdir, "b-skill") {
		t.Fatalf("base dir = %q", img.BaseDir)
	}

	p := Prompt(list)
	for _, want := range []string{"<available_skills>", "image-gen", "Generate an image.", xmlEscape(img.Path), xmlEscape(img.BaseDir)} {
		if !strings.Contains(p, want) {
			t.Fatalf("prompt missing %q\n%s", want, p)
		}
	}

	enabled := Enabled(list, map[string]bool{"image-gen": true})
	if len(enabled) != 1 || enabled[0].Name != "a-skill" {
		t.Fatalf("enabled filter = %+v", enabled)
	}
	if Prompt(nil) != "" {
		t.Fatal("empty prompt expected for no skills")
	}
}

func TestParseFrontmatter(t *testing.T) {
	fm := parseFrontmatter("---\nname: x\n description: nested-skip\nicon: '🔧'\n---\nbody")
	if fm["name"] != "x" {
		t.Fatalf("name = %q", fm["name"])
	}
	if fm["icon"] != "🔧" {
		t.Fatalf("icon = %q", fm["icon"])
	}
	if _, ok := fm["description"]; ok {
		t.Fatal("nested (indented) key should be skipped")
	}
	if len(parseFrontmatter("no frontmatter here")) != 0 {
		t.Fatal("expected no frontmatter")
	}
}

func TestEnsureGuide(t *testing.T) {
	ws := t.TempDir()
	if err := EnsureGuide(ws); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(ws, Subdir, "README.md")); err != nil {
		t.Fatalf("guide not created: %v", err)
	}
}
