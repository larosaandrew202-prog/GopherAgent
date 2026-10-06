package imagegen

import "testing"

func TestNativeVendor(t *testing.T) {
	cases := map[string]string{
		"gpt-image-1":                VendorOpenAI,
		"dall-e-3":                   VendorOpenAI,
		"nano-banana-2":              VendorGemini,
		"gemini-2.5-flash-image":     VendorGemini,
		"seedream-5.0-lite":          VendorArk,
		"doubao-seedream-5-0-260128": VendorArk,
		"qwen-image-2.0":             VendorDashscope,
		"wanx2.1-t2i-turbo":          VendorDashscope,
		"image-01":                   VendorMinimax,
		"":                           "",
		"some-unknown-model-v9":      "",
	}
	for model, want := range cases {
		if got := nativeVendor(model); got != want {
			t.Errorf("nativeVendor(%q) = %q, want %q", model, got, want)
		}
	}
}

func TestResolveOpenAISize(t *testing.T) {
	cases := []struct {
		size, ratio, want string
	}{
		{"", "", ""},
		{"1024x1024", "", "1024x1024"},
		{"1024*1024", "", "1024x1024"},
		{"1K", "", "1024x1024"},
		{"1K", "16:9", "1536x1024"},
		{"2K", "", "2048x2048"},
		{"4K", "9:16", "2160x3840"},
		{"", "16:9", "1536x1024"},
	}
	for _, c := range cases {
		if got := resolveOpenAISize(c.size, c.ratio); got != c.want {
			t.Errorf("resolveOpenAISize(%q,%q) = %q, want %q", c.size, c.ratio, got, c.want)
		}
	}
}

func TestResolveProviderSizes(t *testing.T) {
	if got := resolveArkSize("1K", ""); got != "2K" {
		t.Errorf("ark 1K -> %q, want 2K", got)
	}
	if got := resolveArkSize("4K", ""); got != "4K" {
		t.Errorf("ark 4K -> %q, want 4K", got)
	}
	if got := resolveQwenSize("1024x1024", ""); got != "1024*1024" {
		t.Errorf("qwen pixel -> %q, want 1024*1024", got)
	}
	if got := resolveQwenSize("2K", ""); got != "2048*2048" {
		t.Errorf("qwen 2K -> %q, want 2048*2048", got)
	}
}

func TestGeminiImageConfig(t *testing.T) {
	tier, ratio := geminiImageConfig("2048x2048", "16:9")
	if tier != "2K" || ratio != "16:9" {
		t.Errorf("gemini config = %q,%q want 2K,16:9", tier, ratio)
	}
	tier, _ = geminiImageConfig("3K", "")
	if tier != "2K" {
		t.Errorf("gemini 3K -> %q, want 2K", tier)
	}
}

func TestPromote(t *testing.T) {
	got := promote([]string{"openai", "gemini", "doubao"}, "doubao")
	want := []string{"doubao", "openai", "gemini"}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("promote = %v, want %v", got, want)
		}
	}
}
