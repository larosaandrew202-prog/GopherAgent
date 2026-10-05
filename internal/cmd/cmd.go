package cmd

import (
	"context"
	"fmt"
	"net/http"

	"github.com/gogf/gf/v2/frame/g"
	"github.com/gogf/gf/v2/net/ghttp"
	"github.com/gogf/gf/v2/os/gcmd"

	"GopherAgent/internal/consts"
	"GopherAgent/internal/controller/api"
	configlogic "GopherAgent/internal/logic/config"
	memorylogic "GopherAgent/internal/logic/memory"
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
