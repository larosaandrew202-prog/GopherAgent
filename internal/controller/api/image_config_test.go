package api

import (
	"testing"

	"GopherAgent/internal/consts"
)

func TestImageConfigKeysEditable(t *testing.T) {
	keys := []string{
		consts.CfgImageEnabled, consts.CfgImageProvider, consts.CfgImageModel,
		consts.CfgImageAPIKey, consts.CfgImageAPIBase, consts.CfgImageSize,
		consts.CfgImageQuality, consts.CfgImageMaxPerCall, consts.CfgImageTimeoutSec,
		consts.CfgImageFallback, consts.CfgImageOutputDir,
	}
	for _, k := range keys {
		if _, ok := editableKeySet[k]; !ok {
			t.Errorf("%s is not editable via /config", k)
		}
	}
}

func TestImageConfigCoerce(t *testing.T) {
	if v := coerce(consts.CfgImageEnabled, "true"); v != true {
		t.Errorf("image_enabled coerce = %#v, want true", v)
	}
	if v := coerce(consts.CfgImageFallback, false); v != false {
		t.Errorf("image_fallback coerce = %#v, want false", v)
	}
	if v := coerce(consts.CfgImageMaxPerCall, "3"); v != 3 {
		t.Errorf("image_max_per_call coerce = %#v, want 3", v)
	}
	if v := coerce(consts.CfgImageTimeoutSec, 120.0); v != 120 {
		t.Errorf("image_timeout_sec coerce = %#v, want 120", v)
	}
}
