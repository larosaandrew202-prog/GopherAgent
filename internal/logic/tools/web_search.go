package tools

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/gogf/gf/v2/util/gconv"

	"GopherAgent/internal/consts"
	configlogic "GopherAgent/internal/logic/config"
)

// searchProviderOrder is the fallback preference order.
var searchProviderOrder = []string{
	consts.SearchProviderBocha,
	consts.SearchProviderQianfan,
	consts.SearchProviderZhipu,
}

// WebSearchTool searches the web through a configured provider.
type WebSearchTool struct{}

func (WebSearchTool) Name() string { return consts.ToolWebSearch }

func (WebSearchTool) Description() string {
	return "Search the web for real-time information. Returns titles, URLs and snippets. " +
		"Requires a configured search provider (bocha / zhipu / qianfan)."
}

func (WebSearchTool) Parameters() map[string]interface{} {
	return map[string]interface{}{
		"type": "object",
		"properties": map[string]interface{}{
			"query":     map[string]interface{}{"type": "string", "description": "Search query."},
			"count":     map[string]interface{}{"type": "integer", "description": "Number of results (1-50, default 10)."},
			"freshness": map[string]interface{}{"type": "string", "description": "Time filter: noLimit | oneDay | oneWeek | oneMonth | oneYear."},
			"provider":  map[string]interface{}{"type": "string", "description": "Optional search backend override."},
		},
		"required": []string{"query"},
	}
}

type searchResult struct {
	Title   string
	URL     string
	Snippet string
	Site    string
	Date    string
}

func (WebSearchTool) Execute(ctx context.Context, args map[string]interface{}, ec ExecContext) (string, error) {
	query := strings.TrimSpace(strArg(args, "query"))
	if query == "" {
		return "", fmt.Errorf("query is required")
	}
	count := intArg(args, "count", 10)
	if count < 1 || count > 50 {
		count = 10
	}
	freshness := strings.TrimSpace(strArg(args, "freshness"))
	if freshness == "" {
		freshness = "noLimit"
	}

	provider := resolveSearchProvider(strArg(args, "provider"))
	if provider == "" {
		return "", fmt.Errorf("no web search provider configured; set bocha_api_key (or zhipu_ai_api_key / qianfan_api_key)")
	}

	var (
		results []searchResult
		err     error
	)
	switch provider {
	case consts.SearchProviderBocha:
		results, err = searchBocha(ctx, query, count, freshness)
	case consts.SearchProviderZhipu:
		results, err = searchZhipu(ctx, query, count, freshness)
	case consts.SearchProviderQianfan:
		results, err = searchQianfan(ctx, query, count, freshness)
	default:
		return "", fmt.Errorf("unknown search provider %q", provider)
	}
	if err != nil {
		return "", err
	}

	var b strings.Builder
	fmt.Fprintf(&b, "Search results for %q (provider=%s, %d results):", query, provider, len(results))
	if len(results) == 0 {
		return b.String() + "\n(no results)", nil
	}
	for i, r := range results {
		fmt.Fprintf(&b, "\n\n%d. %s", i+1, r.Title)
		if r.Site != "" {
			fmt.Fprintf(&b, "  [%s]", r.Site)
		}
		if r.URL != "" {
			fmt.Fprintf(&b, "\n   %s", r.URL)
		}
		if r.Snippet != "" {
			fmt.Fprintf(&b, "\n   %s", r.Snippet)
		}
		if r.Date != "" {
			fmt.Fprintf(&b, "\n   日期: %s", r.Date)
		}
	}
	return b.String(), nil
}

// ---------------------------------------------------------------------------
// provider configuration
// ---------------------------------------------------------------------------

func searchAPIKey(provider string) string {
	s := configlogic.C()
	switch provider {
	case consts.SearchProviderBocha:
		return strings.TrimSpace(s.GetString(consts.CfgBochaAPIKey))
	case consts.SearchProviderZhipu:
		return strings.TrimSpace(s.GetString(consts.CfgZhipuAPIKey))
	case consts.SearchProviderQianfan:
		return strings.TrimSpace(s.GetString(consts.CfgQianfanAPIKey))
	}
	return ""
}

func configuredSearchProviders() []string {
	out := make([]string, 0, len(searchProviderOrder))
	for _, p := range searchProviderOrder {
		if searchAPIKey(p) != "" {
			out = append(out, p)
		}
	}
	return out
}

func resolveSearchProvider(requested string) string {
	available := configuredSearchProviders()
	if len(available) == 0 {
		return ""
	}
	requested = strings.ToLower(strings.TrimSpace(requested))
	if requested != "" {
		for _, p := range available {
			if p == requested {
				return p
			}
		}
	}
	s := configlogic.C()
	if strings.ToLower(s.GetString(consts.CfgWebSearchStrategy)) == consts.SearchStrategyFixed {
		pinned := strings.ToLower(strings.TrimSpace(s.GetString(consts.CfgWebSearchProvider)))
		for _, p := range available {
			if p == pinned {
				return p
			}
		}
	}
	return available[0]
}

// ---------------------------------------------------------------------------
// providers
// ---------------------------------------------------------------------------

func searchBocha(ctx context.Context, query string, count int, freshness string) ([]searchResult, error) {
	payload := map[string]interface{}{"query": query, "count": count, "freshness": freshness, "summary": false}
	headers := map[string]string{"Authorization": "Bearer " + searchAPIKey("bocha")}
	body, err := postJSON(ctx, "https://api.bochaai.com/v1/web-search", headers, payload)
	if err != nil {
		return nil, err
	}
	var data struct {
		Code interface{} `json:"code"`
		Msg  string      `json:"msg"`
		Data struct {
			WebPages struct {
				Value []struct {
					Name          string `json:"name"`
					URL           string `json:"url"`
					Snippet       string `json:"snippet"`
					Summary       string `json:"summary"`
					SiteName      string `json:"siteName"`
					DatePublished string `json:"datePublished"`
				} `json:"value"`
			} `json:"webPages"`
		} `json:"data"`
	}
	if err := json.Unmarshal(body, &data); err != nil {
		return nil, err
	}
	if code := gconv.Int(data.Code); code != 0 && code != 200 {
		return nil, fmt.Errorf("bocha error %d: %s", code, data.Msg)
	}
	out := make([]searchResult, 0, len(data.Data.WebPages.Value))
	for _, p := range data.Data.WebPages.Value {
		snippet := p.Snippet
		if snippet == "" {
			snippet = p.Summary
		}
		out = append(out, searchResult{Title: p.Name, URL: p.URL, Snippet: snippet, Site: p.SiteName, Date: p.DatePublished})
	}
	return out, nil
}

func searchZhipu(ctx context.Context, query string, count int, freshness string) ([]searchResult, error) {
	base := strings.TrimRight(configlogic.C().GetString(consts.CfgZhipuAPIBase), "/")
	if base == "" {
		base = "https://open.bigmodel.cn/api/paas/v4"
	}
	query = trimRunes(query, 70)
	payload := map[string]interface{}{
		"search_engine":         "search_pro",
		"search_query":          query,
		"search_intent":         false,
		"count":                 count,
		"search_recency_filter": normalFreshness(freshness),
	}
	headers := map[string]string{"Authorization": "Bearer " + searchAPIKey("zhipu")}
	body, err := postJSON(ctx, base+"/web_search", headers, payload)
	if err != nil {
		return nil, err
	}
	var data struct {
		SearchResult []struct {
			Title       string `json:"title"`
			Link        string `json:"link"`
			URL         string `json:"url"`
			Content     string `json:"content"`
			Snippet     string `json:"snippet"`
			Media       string `json:"media"`
			PublishDate string `json:"publish_date"`
		} `json:"search_result"`
		Error *struct {
			Code    interface{} `json:"code"`
			Message string      `json:"message"`
		} `json:"error"`
	}
	if err := json.Unmarshal(body, &data); err != nil {
		return nil, err
	}
	if data.Error != nil {
		return nil, fmt.Errorf("zhipu error %v: %s", data.Error.Code, data.Error.Message)
	}
	out := make([]searchResult, 0, len(data.SearchResult))
	for _, it := range data.SearchResult {
		link := it.Link
		if link == "" {
			link = it.URL
		}
		snippet := it.Content
		if snippet == "" {
			snippet = it.Snippet
		}
		out = append(out, searchResult{Title: it.Title, URL: link, Snippet: snippet, Site: it.Media, Date: it.PublishDate})
	}
	return out, nil
}

func searchQianfan(ctx context.Context, query string, count int, freshness string) ([]searchResult, error) {
	base := strings.TrimRight(configlogic.C().GetString(consts.CfgQianfanAPIBase), "/")
	if base == "" {
		base = "https://qianfan.baidubce.com/v2"
	}
	payload := map[string]interface{}{
		"messages":             []map[string]string{{"role": consts.RoleUser, "content": query}},
		"search_source":        "baidu_search_v2",
		"resource_type_filter": []map[string]interface{}{{"type": "web", "top_k": count}},
	}
	headers := map[string]string{
		"Authorization":     "Bearer " + searchAPIKey("qianfan"),
		"X-Appbuilder-From": "gopher",
	}
	body, err := postJSON(ctx, base+"/ai_search/web_search", headers, payload)
	if err != nil {
		return nil, err
	}
	var data struct {
		References []struct {
			Title     string `json:"title"`
			URL       string `json:"url"`
			Content   string `json:"content"`
			WebAnchor string `json:"web_anchor"`
			Website   string `json:"website"`
			Date      string `json:"date"`
		} `json:"references"`
		Code    interface{} `json:"code"`
		Message string      `json:"message"`
	}
	if err := json.Unmarshal(body, &data); err != nil {
		return nil, err
	}
	if data.Message != "" {
		return nil, fmt.Errorf("qianfan error %v: %s", data.Code, data.Message)
	}
	out := make([]searchResult, 0, len(data.References))
	for _, d := range data.References {
		site := d.WebAnchor
		if site == "" {
			site = d.Website
		}
		out = append(out, searchResult{Title: d.Title, URL: d.URL, Snippet: trimRunes(d.Content, 200), Site: site, Date: d.Date})
	}
	return out, nil
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

func postJSON(ctx context.Context, rawURL string, headers map[string]string, payload interface{}) ([]byte, error) {
	parsed, err := url.Parse(rawURL)
	if err != nil {
		return nil, err
	}
	if blockedHost(parsed.Hostname()) {
		return nil, fmt.Errorf("refusing to call private host %s", parsed.Hostname())
	}

	body, err := json.Marshal(payload)
	if err != nil {
		return nil, err
	}
	reqCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(reqCtx, http.MethodPost, rawURL, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	req.Header.Set("User-Agent", "GopherAgent/0.2")
	for k, v := range headers {
		req.Header.Set(k, v)
	}

	resp, err := searchHTTPClient().Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	data, err := io.ReadAll(io.LimitReader(resp.Body, 2<<20))
	if err != nil {
		return nil, err
	}
	if resp.StatusCode >= 400 {
		return nil, fmt.Errorf("HTTP %d: %s", resp.StatusCode, strings.TrimSpace(string(trimBytes(data, 300))))
	}
	return data, nil
}

var (
	searchClient     *http.Client
	searchClientOnce sync.Once
)

func searchHTTPClient() *http.Client {
	searchClientOnce.Do(func() {
		transport := &http.Transport{Proxy: http.ProxyFromEnvironment}
		if proxy := configlogic.C().GetString(consts.CfgProxy); proxy != "" {
			if u, err := url.Parse(proxy); err == nil {
				transport.Proxy = http.ProxyURL(u)
			}
		}
		searchClient = &http.Client{Transport: transport, Timeout: 30 * time.Second}
	})
	return searchClient
}

func normalFreshness(v string) string {
	switch v {
	case "oneDay", "oneWeek", "oneMonth", "oneYear", "noLimit":
		return v
	default:
		return "noLimit"
	}
}

func trimRunes(s string, n int) string {
	r := []rune(s)
	if len(r) <= n {
		return s
	}
	return string(r[:n])
}

func trimBytes(b []byte, n int) []byte {
	if len(b) <= n {
		return b
	}
	return b[:n]
}
