// Package api implements the HTTP surface expected by the Gopher Agent
// console (a port of CowAgent's channel/web/web_channel.py).
package api

import (
	"encoding/json"

	"github.com/gogf/gf/v2/frame/g"
	"github.com/gogf/gf/v2/net/ghttp"

	"GopherAgent/internal/consts"
)

// writeJSON writes v as a UTF-8 JSON response.
func writeJSON(r *ghttp.Request, v interface{}) {
	data, err := json.Marshal(v)
	if err != nil {
		data = []byte(`{"status":"error","message":"encode error"}`)
	}
	r.Response.Header().Set("Content-Type", "application/json; charset=utf-8")
	r.Response.Write(data)
}

// ok writes a success envelope merged with data.
func ok(r *ghttp.Request, data g.Map) {
	if data == nil {
		data = g.Map{}
	}
	data["status"] = consts.StatusSuccess
	writeJSON(r, data)
}

// fail writes an error envelope.
func fail(r *ghttp.Request, message string) {
	writeJSON(r, g.Map{"status": consts.StatusError, "message": message})
}

// parseBody decodes the JSON/form body into dst. Missing/invalid bodies are
// tolerated so handlers can apply their own defaults.
func parseBody(r *ghttp.Request, dst interface{}) error {
	return r.Parse(dst)
}
