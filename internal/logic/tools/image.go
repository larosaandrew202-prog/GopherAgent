package tools

import (
	"context"
	"encoding/json"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"strings"

	"github.com/gogf/gf/v2/util/guid"

	"GopherAgent/internal/consts"
	configlogic "GopherAgent/internal/logic/config"
	"GopherAgent/internal/logic/imagegen"
	"GopherAgent/internal/logic/paths"
)

// ImageGenTool generates and edits images via the configured image providers.
type ImageGenTool struct{}

func (ImageGenTool) Name() string { return consts.ToolImageGen }

func (ImageGenTool) Description() string {
	return "Generate or edit images from a text prompt and save the result to the workspace. " +
		"Use when the user asks to create, draw, design or edit a picture, illustration, icon or poster. " +
		"Always call this tool to produce a fresh image for the current request — never reuse or " +
		"reference an image from earlier in the conversation. The generated image is displayed to " +
		"the user automatically, so do not embed image markdown or file paths in your reply; " +
		"just describe the result."
}

func (ImageGenTool) Parameters() map[string]interface{} {
	return map[string]interface{}{
		"type": "object",
		"properties": map[string]interface{}{
			"prompt": map[string]interface{}{"type": "string", "description": "Description of the image to generate."},
			"image": map[string]interface{}{
				"type":        "array",
				"items":       map[string]interface{}{"type": "string"},
				"description": "Optional input image path(s) or URL(s) to edit or fuse.",
			},
			"size":         map[string]interface{}{"type": "string", "description": "512 / 1K / 2K / 4K, or WxH. Default auto."},
			"aspect_ratio": map[string]interface{}{"type": "string", "description": "e.g. 1:1, 16:9, 9:16."},
			"quality":      map[string]interface{}{"type": "string", "description": "low / medium / high (providers that support it)."},
			"n":            map[string]interface{}{"type": "integer", "description": "Number of images (default 1)."},
		},
		"required": []string{"prompt"},
	}
}

func (t ImageGenTool) Execute(ctx context.Context, args map[string]interface{}, ec ExecContext) (string, error) {
	res, err := t.ExecuteRich(ctx, args, ec)
	return res.Output, err
}

// ExecuteRich generates images and returns them as structured media.
func (ImageGenTool) ExecuteRich(ctx context.Context, args map[string]interface{}, ec ExecContext) (RichResult, error) {
	opts := imagegen.OptionsFromConfig()
	if !opts.Enabled {
		return RichResult{Output: "Image generation is disabled. Enable image_enabled and configure a provider API key in the settings."}, nil
	}
	prompt := strings.TrimSpace(strArg(args, "prompt"))
	if prompt == "" {
		return RichResult{}, fmt.Errorf("prompt is required")
	}

	req := imagegen.Request{
		Prompt:      prompt,
		Images:      strSliceArg(args, "image"),
		Size:        strArg(args, "size"),
		AspectRatio: strArg(args, "aspect_ratio"),
		Quality:     strArg(args, "quality"),
		N:           intArg(args, "n", 1),
	}

	providerName, model, results, err := imagegen.Generate(ctx, opts, req)
	if err != nil {
		return RichResult{}, err
	}

	ws := paths.Workspace()
	outDir := imageOutputDir(ws)
	if err := os.MkdirAll(outDir, 0o755); err != nil {
		return RichResult{}, fmt.Errorf("create image dir: %w", err)
	}

	var media []Media
	relPaths := make([]string, 0, len(results))
	for _, r := range results {
		full := filepath.Join(outDir, imageFileName(r.Ext))
		if err := os.WriteFile(full, r.Data, 0o644); err != nil {
			return RichResult{}, fmt.Errorf("write image: %w", err)
		}
		rel, relErr := filepath.Rel(ws, full)
		if relErr != nil || strings.HasPrefix(rel, "..") {
			rel = filepath.Base(full)
		}
		rel = filepath.ToSlash(rel)
		relPaths = append(relPaths, rel)
		media = append(media, Media{
			Path: rel,
			Type: consts.MediaTypeImage,
			MIME: imageMimeForExt(r.Ext),
			URL:  "/api/media?path=" + url.QueryEscape(rel),
		})
	}

	payload, _ := json.Marshal(map[string]interface{}{
		"provider": providerName,
		"model":    model,
		"images":   relPaths,
		"note":     "A fresh image was just generated and is shown to the user automatically. Do not embed image markdown or file paths, and do not reference images from earlier turns.",
	})
	return RichResult{Output: string(payload), Media: media}, nil
}

// imageFileName returns a collision-resistant filename for a generated image.
// NOTE: always use the full guid (32 chars). guid.S() is
// MACHash(7)+PID(4)+timestamp+sequence+random, so its leading bytes are
// constant for the whole process — truncating them made every image reuse the
// same name and overwrite the previous file.
func imageFileName(ext string) string {
	return guid.S() + "." + ext
}

// imageOutputDir resolves the directory generated images are saved to. It is
// always confined to the agent workspace.
func imageOutputDir(ws string) string {
	dir := strings.TrimSpace(configlogic.C().GetString(consts.CfgImageOutputDir))
	if dir == "" {
		return filepath.Join(ws, "images")
	}
	if filepath.IsAbs(dir) {
		if rel, err := filepath.Rel(ws, dir); err == nil && !strings.HasPrefix(rel, "..") {
			return dir
		}
		return filepath.Join(ws, "images")
	}
	return filepath.Join(ws, filepath.Clean(dir))
}

func strSliceArg(args map[string]interface{}, key string) []string {
	v, ok := args[key]
	if !ok || v == nil {
		return nil
	}
	switch t := v.(type) {
	case string:
		if strings.TrimSpace(t) == "" {
			return nil
		}
		return []string{t}
	case []interface{}:
		out := make([]string, 0, len(t))
		for _, item := range t {
			if s, ok := item.(string); ok && strings.TrimSpace(s) != "" {
				out = append(out, s)
			}
		}
		return out
	case []string:
		return t
	default:
		return nil
	}
}

func imageMimeForExt(ext string) string {
	switch strings.ToLower(ext) {
	case "jpg", "jpeg":
		return "image/jpeg"
	case "webp":
		return "image/webp"
	default:
		return "image/png"
	}
}
