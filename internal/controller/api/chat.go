package api

import (
	"encoding/json"

	"github.com/gogf/gf/v2/frame/g"
	"github.com/gogf/gf/v2/net/ghttp"

	"GopherAgent/internal/consts"
	chatlogic "GopherAgent/internal/logic/chat"
)

// PostMessage accepts a user message and returns a request id for streaming.
func PostMessage(r *ghttp.Request) {
	if !requireAuth(r) {
		return
	}
	var body struct {
		SessionID   string                   `json:"session_id"`
		Message     string                   `json:"message"`
		Attachments []map[string]interface{} `json:"attachments"`
		IsVoice     bool                     `json:"is_voice"`
		Steer       bool                     `json:"steer"`
	}
	_ = parseBody(r, &body)

	req := chatlogic.SendRequest{
		SessionID: body.SessionID,
		Message:   body.Message,
		IsVoice:   body.IsVoice,
		Steer:     body.Steer,
	}
	for _, att := range body.Attachments {
		req.Attachments = append(req.Attachments, chatlogic.Attachment{
			FilePath: firstNonEmpty(asString(att["file_path"]), asString(att["path"])),
			FileType: asString(att["file_type"]),
			FileName: firstNonEmpty(asString(att["file_name"]), asString(att["name"])),
		})
	}

	res, err := chatlogic.Send(r.Context(), req)
	if err != nil {
		fail(r, err.Error())
		return
	}
	writeJSON(r, g.Map{
		"status":       consts.StatusSuccess,
		"request_id":   res.RequestID,
		"stream":       res.Stream,
		"inline_reply": res.InlineReply,
		"steered":      res.Steered,
	})
}

// StreamChat streams a request's SSE events (also used for reconnects).
func StreamChat(r *ghttp.Request) {
	if !requireAuth(r) {
		return
	}
	requestID := r.Get("request_id").String()
	afterSeq := r.Get("after_seq").Int()
	if requestID == "" {
		r.Response.WriteStatus(400)
		r.Response.WriteJson(g.Map{"status": consts.StatusError, "message": "request_id is required"})
		return
	}

	r.Response.Header().Set("Content-Type", "text/event-stream; charset=utf-8")
	r.Response.Header().Set("Cache-Control", "no-cache")
	r.Response.Header().Set("Connection", "keep-alive")
	r.Response.Header().Set("X-Accel-Buffering", "no")
	r.Response.Write(": stream start\n\n")
	r.Response.Flush()

	emit := func(e chatlogic.Event) error {
		data, err := json.Marshal(e.Data)
		if err != nil {
			return nil
		}
		r.Response.Write("data: " + string(data) + "\n\n")
		r.Response.Flush()
		return nil
	}

	if found := chatlogic.HubInstance().Subscribe(r.Context(), requestID, afterSeq, emit); !found {
		r.Response.Write("data: {\"type\": \"error\", \"message\": \"invalid request_id\"}\n\n")
		r.Response.Flush()
	}
}

// CancelChat cancels an in-flight request.
func CancelChat(r *ghttp.Request) {
	if !requireAuth(r) {
		return
	}
	var body struct {
		RequestID string `json:"request_id"`
		SessionID string `json:"session_id"`
	}
	_ = parseBody(r, &body)
	chatlogic.Cancel(r.Context(), body.SessionID, body.RequestID)
	ok(r, g.Map{})
}

func firstNonEmpty(values ...string) string {
	for _, v := range values {
		if v != "" {
			return v
		}
	}
	return ""
}
