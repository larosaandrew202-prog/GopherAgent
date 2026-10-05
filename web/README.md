# Gopher Agent Console

React + TypeScript + Vite console for Gopher Agent. It is the frontend for the
Gopher Agent backend (a Go service exposing an HTTP API).

The app is developed against a **static mock API layer** by default, so it runs
standalone with no backend. Point it at the real backend by setting one
environment variable.

## Quick start

```bash
npm install
npm run dev        # http://localhost:5173
```

```bash
npm run build      # type-check + production build into dist/
npm run preview    # serve the production build
npm run lint       # tsc --noEmit
```

Node 18+ is recommended.

## Mock vs. real backend

The API lives in `src/api/`:

- `client.ts` exports a single typed `api` object. All app code calls `api.*`,
  never `fetch` directly.
- `mockData.ts` holds the fixtures used by the mock implementation.
- The mock layer simulates chat streaming (reasoning → tool call → streamed
  Markdown), the log stream, QR login, terminal, and all management endpoints.

To talk to the real backend, create `.env.local`:

```bash
VITE_USE_MOCK=false
VITE_BACKEND_URL=http://localhost:9899   # GopherAgent Go backend (go run main.go)
```

When `VITE_BACKEND_URL` is set, every request is sent to that absolute origin
(no dev proxy needed) and the value is baked into production builds. The Go
backend enables CORS, so cross-origin calls — including credentialed
`EventSource` streams — work directly. When the variable is empty, requests
stay same-origin and the Vite dev server proxies `/api`, `/message`, `/upload`,
`/stream`, `/cancel`, `/config`, `/auth`, `/preview`, and `/mcp` to the backend
instead.

## Features

- **Chat** — streaming responses (SSE-shaped events), reasoning/thinking,
  tool-call steps, Markdown with syntax highlighting + code copy buttons,
  attachments (file/folder upload, drag & drop), voice input/output hooks,
  slash commands, `@` file references, per-session permission and model
  selection, edit / regenerate / delete messages, clear context.
- **Sessions** — history panel grouped by pinned / project / time, pin, rename,
  delete, new chat, project spaces.
- **Workspace panel** — file tree + search, inline preview (Markdown, HTML,
  code, image, video, audio, PDF), open externally / download / copy path.
- **Config** — model, agent, security and system settings.
- **Models** — provider credentials and per-capability configuration (chat,
  vision, image, ASR, TTS, embedding, search).
- **Skills** — built-in tools and installed skills with enable/disable.
- **Memory** — memory files and self-evolution records, Markdown viewer.
- **Knowledge** — document tree, search, Markdown viewer, create/import,
  interactive d3 force graph.
- **Channels** — active channels, field configuration, WeChat QR login, Feishu
  one-click app creation.
- **Tasks** — scheduled task list, run-now, enable/disable, and a full editor.
- **Logs** — live `run.log` stream with level filters.
- **Shell** — dark/light theme, zh / zh-Hant / en i18n, collapsible sidebar,
  login overlay, toasts, confirm/prompt dialogs.

## Project structure

```
src/
  api/            typed API client + mock fixtures
  components/
    chat/         chat view, composer, messages, markdown, tool steps
    layout/       shell, sidebar, header, session/workspace panels, modals
    ui/           shared primitives (Dropdown, Toggle, Modal, Field, …)
  i18n/           generated dictionary + provider/hook
  lib/            markdown pipeline, constants, formatting
  store/          React contexts: ui, auth, chat, workspace
  styles/         Tailwind entry + console.css (from the original app)
  views/          config, skills, memory, knowledge, channels, tasks, logs
public/assets/    fonts, highlight.js themes, provider logos (copied)
```

## Reusing the original assets

`src/styles/console.css`, the Inter webfonts, the highlight.js themes and the
provider logos are vendored static assets. Their class names are reused so the
components keep the original console look.

The i18n dictionary is generated from the original console dictionary:

```bash
node scripts/extract-i18n.mjs <path-to-console.js>
```

Regenerate it only when the source translations change.

## Backend integration status

The service layer implements both a mock and an HTTP client for every endpoint
exposed by the backend. The HTTP implementation is ready to use; the mock
is the default so the UI can be developed and demoed independently. Streaming
uses `EventSource` against `/stream` in HTTP mode and an in-memory event plan in
mock mode.
