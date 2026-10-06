package chat

import "testing"

func TestStripWorkspaceImages(t *testing.T) {
	cases := []struct{ in, want string }{
		{"![image](/api/media?path=images/a.png)", ""},
		{"see ![x](images/a.png) now", "see  now"},
		{"keep ![web](https://example.com/b.png)", "keep ![web](https://example.com/b.png)"},
		{"keep ![alt](data:image/png;base64,AAAA)", "keep ![alt](data:image/png;base64,AAAA)"},
		{"no images here", "no images here"},
		{
			"![image](/api/media?path=images/a.png)\n\n![image](/api/media?path=images/b.png)",
			"\n\n",
		},
	}
	for _, c := range cases {
		if got := stripWorkspaceImages(c.in); got != c.want {
			t.Errorf("stripWorkspaceImages(%q) = %q, want %q", c.in, got, c.want)
		}
	}
}

func TestIsWorkspaceMediaURL(t *testing.T) {
	yes := []string{"/api/media?path=images/a.png", "images/a.png", "/workspace/images/a.png"}
	no := []string{"https://example.com/a.png", "data:image/png;base64,AA", "#anchor", ""}
	for _, u := range yes {
		if !isWorkspaceMediaURL(u) {
			t.Errorf("isWorkspaceMediaURL(%q) = false, want true", u)
		}
	}
	for _, u := range no {
		if isWorkspaceMediaURL(u) {
			t.Errorf("isWorkspaceMediaURL(%q) = true, want false", u)
		}
	}
}
