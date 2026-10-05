package main

import (
	_ "GopherAgent/internal/packed"

	"github.com/gogf/gf/v2/os/gctx"

	"GopherAgent/internal/cmd"
)

func main() {
	cmd.Main.Run(gctx.GetInitCtx())
}
