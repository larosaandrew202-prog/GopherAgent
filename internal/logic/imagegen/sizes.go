package imagegen

import (
	"fmt"
	"regexp"
	"strings"
)

var pixelRe = regexp.MustCompile(`^\d+[x*]\d+$`)

func isPixel(s string) bool { return pixelRe.MatchString(strings.TrimSpace(s)) }

func pickRatio(ratio, def string, table map[string]string) string {
	if ratio == "" {
		return def
	}
	if v, ok := table[ratio]; ok {
		return v
	}
	return def
}

// resolveOpenAISize maps a tier/pixel size to a concrete "WxH" OpenAI accepts.
func resolveOpenAISize(size, ratio string) string {
	size = strings.TrimSpace(size)
	if isPixel(size) {
		return strings.ReplaceAll(strings.ToLower(size), "*", "x")
	}
	switch strings.ToUpper(size) {
	case "512":
		return "512x512"
	case "1K":
		return pickRatio(ratio, "1024x1024", map[string]string{
			"16:9": "1536x1024", "9:16": "1024x1536", "3:2": "1536x1024", "2:3": "1024x1536",
		})
	case "2K":
		return pickRatio(ratio, "2048x2048", map[string]string{
			"16:9": "2048x1152", "9:16": "1152x2048", "3:2": "2048x1365", "2:3": "1365x2048",
		})
	case "4K":
		return pickRatio(ratio, "3840x2160", map[string]string{
			"1:1": "4096x4096", "9:16": "2160x3840",
		})
	}
	if ratio != "" {
		return pickRatio(ratio, "1024x1024", map[string]string{
			"16:9": "1536x1024", "9:16": "1024x1536",
		})
	}
	return ""
}

// resolveArkSize returns a Seedream-compatible size (tier or "WxH").
func resolveArkSize(size, ratio string) string {
	size = strings.TrimSpace(size)
	if isPixel(size) {
		return strings.ReplaceAll(strings.ToLower(size), "*", "x")
	}
	switch strings.ToUpper(size) {
	case "2K", "3K", "4K":
		return strings.ToUpper(size)
	}
	_ = ratio
	return "2K"
}

// resolveQwenSize returns a DashScope "W*H" size.
func resolveQwenSize(size, ratio string) string {
	size = strings.TrimSpace(size)
	if isPixel(size) {
		return strings.ReplaceAll(strings.ToLower(size), "x", "*")
	}
	switch strings.ToUpper(size) {
	case "2K":
		return "2048*2048"
	case "1K":
		return "1024*1024"
	}
	_ = ratio
	return ""
}

// geminiImageConfig maps size/ratio to Gemini's generationConfig.imageConfig.
func geminiImageConfig(size, ratio string) (tier, aspect string) {
	size = strings.TrimSpace(strings.ToLower(strings.ReplaceAll(size, "*", "x")))
	if isPixel(size) {
		var w, h int
		if _, err := fmt.Sscanf(size, "%dx%d", &w, &h); err == nil {
			long := w
			if h > long {
				long = h
			}
			switch {
			case long <= 768:
				tier = "512"
			case long <= 1536:
				tier = "1K"
			case long <= 3072:
				tier = "2K"
			default:
				tier = "4K"
			}
		}
	} else {
		switch strings.ToUpper(size) {
		case "512", "1K", "2K", "4K":
			tier = strings.ToUpper(size)
		case "3K":
			tier = "2K"
		}
	}
	return tier, strings.TrimSpace(ratio)
}

// normalizeQuality returns an OpenAI-compatible quality or "" for auto.
func normalizeQuality(q string) string {
	switch strings.ToLower(strings.TrimSpace(q)) {
	case "low", "medium", "high":
		return strings.ToLower(strings.TrimSpace(q))
	default:
		return ""
	}
}
