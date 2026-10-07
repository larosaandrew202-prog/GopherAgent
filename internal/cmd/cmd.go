package cmd

import (
	"context"
	"fmt"
	"net/http"
	"os"
	"path/filepath"

	"github.com/gogf/gf/v2/frame/g"
	"github.com/gogf/gf/v2/net/ghttp"
	"github.com/gogf/gf/v2/os/gcmd"
	"github.com/gogf/gf/v2/os/glog"

	"GopherAgent/internal/consts"
	"GopherAgent/internal/controller/api"
	configlogic "GopherAgent/internal/logic/config"
	memorylogic "GopherAgent/internal/logic/memory"
	"GopherAgent/internal/logic/paths"
	"GopherAgent/internal/logic/schedulerrun"
	"GopherAgent/internal/store"
)

var (
	Main = gcmd.Command{
		Name:  "main",
		Usage: "main",
		Brief: "start http server",
		Func: func(ctx context.Context, parser *gcmd.Parser) (err error) {
			if err = configlogic.Init(); err != nil {
				return err
			}
			setupLogging()

			port := configlogic.C().GetInt(consts.CfgWebPort, 9899)
			g.Log().Infof(ctx, "GopherAgent database: %s", store.Path())
			g.Log().Infof(ctx, "GopherAgent listening on :%d", port)

			memorylogic.EnsureFiles()
			go func() {
				if _, err := memorylogic.Sync(ctx); err != nil {
					g.Log().Warningf(ctx, "memory index sync failed: %v", err)
				}
			}()

			s := g.Server()
			s.SetAddr(fmt.Sprintf(":%d", port))
			s.Use(cors)

			api.Register(s)
			schedulerrun.Start(ctx)

			s.Run()
			return nil
		},
	}
)

// setupLogging points the default logger at a file the console's log view can
// tail, while still printing to stdout. Level prefixes are set to the full
// words the console colourises on ([INFO], [WARNING], [ERROR], ...).
func setupLogging() {
	logPath := paths.LogFile()
	dir := filepath.Dir(logPath)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return
	}
	if err := g.Log().SetPath(dir); err != nil {
		return
	}
	g.Log().SetFile(filepath.Base(logPath))
	g.Log().SetStdoutPrint(true)
	g.Log().SetLevelPrefixes(map[int]string{
		glog.LEVEL_DEBU: "DEBUG",
		glog.LEVEL_INFO: "INFO",
		glog.LEVEL_NOTI: "INFO",
		glog.LEVEL_WARN: "WARNING",
		glog.LEVEL_ERRO: "ERROR",
		glog.LEVEL_CRIT: "CRITICAL",
	})
	// Create it now so the log view can open it before the first line lands.
	if f, err := os.OpenFile(logPath, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o644); err == nil {
		_ = f.Close()
	}
}

// cors allows the console (served from a different origin) to call the API
// directly when VITE_BACKEND_URL points at this server.
func cors(r *ghttp.Request) {
	if origin := r.Header.Get("Origin"); origin != "" {
		h := r.Response.Header()
		h.Set("Access-Control-Allow-Origin", origin)
		h.Set("Access-Control-Allow-Credentials", "true")
		h.Set("Vary", "Origin")
		h.Set("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS")
		h.Set("Access-Control-Allow-Headers", "Content-Type,Authorization")
	}
	if r.Method == http.MethodOptions {
		r.Response.WriteStatus(http.StatusNoContent)
		r.Exit()
		return
	}
	r.Middleware.Next()
}
