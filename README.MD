# GopherAgent

基于 [GoFrame v2](https://goframe.org/) 的 Agent 后端，对外提供一套 HTTP API，
供本仓库内的 [`web`](./web) 前端（React + Vite + Ant Design）使用。
前后端分离：前端独立开发、构建与部署，后端只提供 API。

当前阶段目标：**跑通「对话」与「配置 API Key」等基础能力**，数据持久化使用 **SQLite**。

---

## ✨ 已实现能力

| 模块 | 说明 |
| :--- | :--- |
| 配置管理 | 配置读写，API Key 返回时脱敏，支持 `GET/POST /config` |
| 模型供应商 | 13 家 OpenAI 兼容供应商；设置 / 清除凭证、自定义厂商、切换主模型 |
| 基础对话 | 多会话、上下文记忆、系统提示词、上下文轮次裁剪 |
| Agent 工具 | 函数调用（function calling）循环，可调用 shell、文件读写编辑、目录、网页抓取/搜索、记忆检索、定时任务等本地工具 |
| 流式对话 | `POST /message` 返回 `request_id`，`GET /stream` 以 SSE 推送 `reasoning / delta / tool_start / tool_end / done / stream_end` |
| 会话管理 | 会话列表 / 重命名 / 置顶 / 删除、历史分页、清空上下文、删除消息、会话级模型与权限 |
| 持久化 | 使用 GoFrame ORM 读写 SQLite，存储配置、会话、消息（`gopher_agent.db`） |
| 长期记忆 | Markdown 记忆文件（`MEMORY.md` + 每日 `memory/YYYY-MM-DD.md`），向量 + 关键词混合检索 |
| CORS | 允许控制台跨域直接调用（支持带凭证的 EventSource） |

> 其余控制台接口（技能、记忆、知识库、通道、定时任务、日志、工作空间等）提供了占位实现，
> 保证前端可正常加载；后续按需补齐。

---

## 🚀 快速开始

```bash
# 在 GopherAgent 目录下（无需任何配置文件）
go run main.go
# -> GopherAgent database: .../gopher_agent.db
# -> GopherAgent listening on :9899
```

验证：

```bash
curl http://localhost:9899/api/health      # {"status":"ok"}
curl http://localhost:9899/api/version     # {"status":"success","version":"0.2.0"}
```

首次启动会自动创建 SQLite 数据库并写入默认配置，不需要 `config.json`。

> 数据目录可通过环境变量 `GOPHER_DATA_DIR`（或 `COW_DATA_DIR`）指定，默认为当前工作目录。

### 配合前端控制台

前端源码位于本仓库的 [`web/`](./web) 目录（React + Vite + antd）。在 `web/` 中：

```bash
cd web
npm install

# web/.env.local
VITE_USE_MOCK=false
VITE_BACKEND_URL=http://localhost:9899

npm run dev        # 开发：http://localhost:5173
npm run build      # 构建：产出 web/dist/
```

前端把所有请求发往 `VITE_BACKEND_URL`（后端已开启 CORS，无需 Vite 代理）。
前后端仍为**分离部署**：后端只提供 API（`go run main.go`），前端可独立开发、构建、部署。

---

## 🔌 接口一览（与控制台对齐）

统一返回 JSON（`status` 为 `success` 或 `error`）：

| 方法 | 路径 | 说明 |
| :--- | :--- | :--- |
| GET | `/api/health` | 存活探针 |
| GET | `/api/version` | 版本 |
| GET | `/auth/check` | 是否需要登录（未设置 `web_password` 时无需登录） |
| POST | `/auth/login` · `/auth/logout` | 控制台登录 / 退出 |
| GET | `/config` | 配置概览（API Key 脱敏、供应商列表） |
| POST | `/config` | 更新配置，`{"updates":{...}}` |
| GET | `/api/models` | 供应商与能力（chat 等） |
| POST | `/api/models` | `set_provider` / `delete_provider` / `set_custom_provider` / `delete_custom_provider` / `set_capability` |
| POST | `/message` | 发送消息，返回 `{status, request_id, stream}` |
| GET | `/stream?request_id=` | SSE 流式事件（支持 `after_seq` 断点续传） |
| POST | `/cancel` | 取消进行中的请求 |
| POST | `/upload` | 附件上传 |
| GET | `/api/sessions` | 会话列表（分页） |
| GET/PUT/DELETE | `/api/sessions/{id}` | 会话详情 / 重命名置顶 / 删除 |
| GET/POST | `/api/sessions/{id}/settings` | 会话级模型与权限 |
| POST | `/api/sessions/{id}/clear_context` | 清空上下文 |
| POST | `/api/sessions/{id}/generate_title` | 生成标题 |
| GET | `/api/history` | 历史消息（分页） |
| POST | `/api/messages/delete` | 删除消息 |
| GET | `/api/projects` · `/api/workspace/*` | 项目 / 工作空间（占位） |
| GET | `/api/tools` · `/api/skills` · `/api/memory` · `/api/knowledge/*` · `/api/channels` · `/api/scheduler` · `/api/logs` | 工具/技能/记忆/知识/通道/定时/日志 |

### 配置 API Key 示例

```bash
# 设置 DeepSeek Key 与主模型
curl -X POST http://localhost:9899/config \
  -H "Content-Type: application/json" \
  -d '{"updates":{"deepseek_api_key":"sk-xxxx","model":"deepseek-v4-flash","bot_type":"deepseek"}}'

# 通过 Models 接口设置（与前端一致）
curl -X POST http://localhost:9899/api/models \
  -H "Content-Type: application/json" \
  -d '{"action":"set_provider","provider_id":"deepseek","api_key":"sk-xxxx","api_base":"https://api.deepseek.com/v1"}'
```

---

## 🛠 Agent 工具（function calling）

对话走的是一个工具调用循环：把工具定义（JSON Schema）随请求发给模型，若模型返回
`tool_calls`，后端会在本地执行对应工具，通过 SSE 推送 `tool_start` / `tool_end`
事件，再把执行结果作为 `tool` 消息回传给模型，直到模型给出最终回答（最多
`agent_max_steps` 步）。

内置工具（`internal/logic/tools`）：

| 工具 | 说明 |
| :--- | :--- |
| `bash` | 执行 shell 命令（Windows 用 PowerShell，其他平台用 bash），返回合并输出 |
| `read` | 读取文本文件，支持 `offset` / `limit` 行范围 |
| `write` | 创建或覆盖文件，自动创建父目录 |
| `edit` | 精确字符串替换（默认要求唯一匹配，可 `replace_all`） |
| `ls` | 列出目录内容（类型 + 大小） |
| `web_fetch` | 抓取 http(s) 页面并转为纯文本（拦截回环/内网地址） |
| `web_search` | 通过已配置的搜索厂商（bocha / zhipu / qianfan）联网检索 |
| `memory_search` | 关键词检索历史对话记忆（默认跨会话，可指定 session_id） |
| `memory_get` | 读取某个会话的一段历史消息 |
| `scheduler` | 创建 / 查询 / 管理定时任务（`once` / `interval` / `cron`） |

相关配置：

- `agent_workspace`：相对路径与 shell 的工作目录，留空则使用进程工作目录
- `agent_max_steps`：单次对话的最大工具步数（默认 30）
- `disabled_tools`：禁用的工具名列表，例如 `["bash"]`
- `agent_permission_mode`：权限模式（当前仅记录，完整权限校验待实现）
- `bocha_api_key`、`web_search_provider`、`web_search_strategy`：联网搜索配置；未配置 `web_search` 会返回明确提示
- 搜索也可复用 `zhipu_ai_api_key` / `qianfan_api_key`

### 定时任务

`scheduler` 工具与后台 worker（`internal/logic/schedulerrun`）共用同一张 `scheduled_tasks` 表：

- 任务类型：`send_message`（到点把固定消息写入会话）与 `agent_task`（到点由 Agent 执行并产出结果）
- 调度：`once`（`+5s`/`+10m`/ISO 时间）、`interval`（秒）、`cron`（5 字段表达式）
- 控制台"定时"页已接入真实接口：`GET /api/scheduler`、`POST /api/scheduler/{run,toggle,update,delete}`
- worker 每 10 秒扫描一次到期任务并执行；`once` 任务执行后自动禁用

> ⚠️ 这些工具能访问并修改本机文件、执行命令、联网，请仅在可信环境使用。

## 🧠 长期记忆与向量检索

长期记忆存放在 agent 工作区的 Markdown 文件里，并在 SQLite 中建立可检索的块索引：

```
<workspace>/MEMORY.md              # 长期事实（每轮对话注入 system prompt）
<workspace>/memory/YYYY-MM-DD.md   # 每日记忆（按日期做时间衰减）
<workspace>/knowledge/**.md        # 知识库（knowledge 开启时）
```

- **工作区**：`agent_workspace`，留空时默认 `<数据目录>/workspace`（不再污染项目根目录）
- **切块**：按行切分，`memory_chunk_tokens`(500) / `memory_chunk_overlap`(50)
- **向量化**：OpenAI 兼容 `/embeddings`，支持 openai / dashscope / zhipu / doubao / custom；批量按厂商上限自动分页
- **索引**：`memory_chunks`（含 `embedding` BLOB）+ `memory_files`（文件 hash 增量），搜索时按 hash 增量同步，embedding 失败保留旧索引
- **混合检索**：`score = vector_weight·向量余弦 + keyword_weight·关键词`，再乘日期文件的时间衰减（半衰期 `memory_half_life_days` 天；MEMORY.md 不衰减）
- **记忆写入**：Agent 用 `write`/`edit` 工具写记忆文件；开启 `memory_auto_flush` 时每累计 `memory_flush_turns` 轮自动把会话摘要追加到今日记忆
- **会话命令**：`/memory rebuild-index`（重建索引）、`/memory flush`（立即总结当前会话到今日记忆）
- **工具**：`memory_search`（混合检索）、`memory_get`（读取记忆文件行区间）

### 向量模型 API 怎么配置

**前端有入口**：控制台「配置 → 高级配置（模型配置）→ 向量（Embedding）」卡片，选择厂商与模型后保存；保存后按提示执行 `/memory rebuild-index` 重建索引。

**后端也有入口**：

```bash
# 方式一：Models 接口（与前端同路径）
curl -X POST http://localhost:9899/api/models \
  -H "Content-Type: application/json" \
  -d '{"action":"set_capability","capability":"embedding","provider":"dashscope","model":"text-embedding-v4"}'

# 方式二：/config 更新（可指定专用 key/base 与维度）
curl -X POST http://localhost:9899/config \
  -H "Content-Type: application/json" \
  -d '{"updates":{
        "embedding_provider":"openai",
        "embedding_model":"text-embedding-3-small",
        "embedding_dimensions":1536,
        "embedding_api_key":"sk-xxxx",
        "embedding_api_base":"https://api.openai.com/v1"
      }}'
```

说明：

- 未单独设置 `embedding_api_key` / `embedding_api_base` 时，自动复用所选厂商的 key/base（如 `openai` → `open_ai_api_key`），因此只要该厂商的凭证已配置即可直接用
- 更换厂商 / 模型 / 维度后需要重建索引（`/memory rebuild-index` 或 `POST /api/models` 保存后前端会提示）
- **未配置任何 embedding 时**，记忆检索自动降级为纯关键词模式，功能仍可用

## 🗂 目录结构

```
GopherAgent/
├── main.go                       # 入口（go run main.go）
├── internal/
│   ├── cmd/cmd.go                # 启动、路由注册、CORS
│   ├── store/sqlite.go           # SQLite 连接（GoFrame sqlite 驱动）与建表
│   ├── controller/
│   │   ├── api/                  # 控制台接口（config/models/chat/sessions/misc）
│   │   └── hello/
│   └── logic/
│       ├── config/               # 配置存储 + 供应商注册表 + 凭证解析
│       │   ├── config.go
│       │   ├── providers.go
│       │   └── template/default.json
│       ├── llm/llm.go            # OpenAI 兼容客户端（流式 + function calling + 摘要）
│       ├── embedding/            # OpenAI 兼容 embeddings（多厂商）
│       ├── tools/                # shell / 文件读写编辑 / ls / web_fetch / web_search / memory / scheduler
│       ├── memory/               # 文件记忆：切块、向量/关键词混合检索、时间衰减
│       ├── paths/                # agent 工作区解析
│       ├── scheduler/            # 定时任务存储与调度计算
│       ├── schedulerrun/         # 定时任务后台执行 worker
│       └── chat/                 # 会话/消息持久化、Agent 工具循环、SSE Hub
│           ├── chat.go
│           ├── store.go
│           └── stream.go
├── web/                          # 前端控制台（React + Vite + antd），前后端分离
│   ├── src/                      # 页面 / 组件 / store / i18n / 样式
│   ├── public/                   # 静态资源（favicon、vendor 字体/JS）
│   ├── index.html
│   └── package.json
└── manifest/config/config.yaml   # 服务端口等（数据库在代码中配置）
```

---

## ⚙️ 供应商与凭证解析

`internal/logic/config/providers.go` 维护供应商表。解析顺序：

1. `bot_type` 显式指定（如 `deepseek`、`openai`、`custom:<id>`）；
2. 未指定时按 `model` 前缀推断；
3. API Key 取厂商字段，为空时回退 `open_ai_api_key`；
4. 自定义厂商存于 `custom_providers`，通过 `bot_type = "custom:<id>"` 激活。

内置：`deepseek`、`openai`、`claudeAPI`、`gemini`、`zhipu`、`dashscope`、`moonshot`、
`doubao`、`qianfan`、`minimax`、`mimo`、`custom`（均走 OpenAI 兼容
`/chat/completions`）。

---

## 🧭 后续规划

- 更多工具（浏览器自动化、定时任务、记忆检索）与多步规划增强
- 工具权限校验（按 `agent_permission_mode` 限制文件/命令范围）
- 向量记忆 / 知识库 / 技能系统
- 多渠道接入（Telegram、飞书、钉钉、企业微信等）
- 真实的工作空间文件管理与项目空间
- 语音识别 / 合成

---

## ⚠️ 免责声明

本项目用于技术研究与学习。Agent 具备访问本机与外部服务的能力，请仅在可信环境中部署。
