package main

import (
	"context"
	"fmt"
	"sort"
	"strings"

	"GopherAgent/internal/logic/config"
	"GopherAgent/internal/logic/redisx"
)

func truncate(s string) string {
	s = strings.ReplaceAll(s, "\n", " ")
	if len(s) > 90 {
		return s[:90] + "..."
	}
	return s
}

func main() {
	_ = config.Init()
	if err := redisx.Init(context.Background()); err != nil {
		panic(err)
	}
	if !redisx.Enabled() {
		fmt.Println("redis disabled")
		return
	}
	rdb := redisx.Client()
	ctx := context.Background()

	var keys []string
	iter := rdb.Scan(ctx, 0, redisx.Prefix()+"*", 1000).Iterator()
	for iter.Next(ctx) {
		keys = append(keys, iter.Val())
	}
	sort.Strings(keys)
	fmt.Printf("prefix=%s  total_keys=%d\n\n", redisx.Prefix(), len(keys))
	for _, k := range keys {
		t, _ := rdb.Type(ctx, k).Result()
		ttl, _ := rdb.TTL(ctx, k).Result()
		val := ""
		switch t {
		case "string":
			v, _ := rdb.Get(ctx, k).Result()
			val = truncate(v)
		case "list":
			n, _ := rdb.LLen(ctx, k).Result()
			first, _ := rdb.LIndex(ctx, k, 0).Result()
			val = fmt.Sprintf("len=%d first=%s", n, truncate(first))
		case "hash":
			m, _ := rdb.HGetAll(ctx, k).Result()
			val = fmt.Sprintf("fields=%d", len(m))
		case "none":
			val = "(gone)"
		}
		fmt.Printf("%-46s type=%-7s ttl=%-8s %s\n", k, t, ttl, val)
	}
}
