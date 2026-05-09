# Next steps: Get canvas-mcp running in Claude Desktop

Automated checks are done: **build**, **lint**, and **tests** all passed. Follow these steps to use the MCP in Claude Desktop.

---

## 1. [MANUAL] Install Node 18+ (if needed)

If you don’t have Node.js 18 or newer, install it from [nodejs.org](https://nodejs.org).

---

## 2. [MANUAL] Get your Canvas API token

1. Log in to Canvas (e.g. canvas.wisc.edu).
2. Go to **Account → Settings** (profile picture → Settings).
3. Scroll to **Approved Integrations**.
4. Click **+ New Access Token**.
5. Name it (e.g. “Claude MCP”), set expiry, create it.
6. **Copy the token** — you won’t see it again.

---

## 3. [MANUAL] Install and build (if you haven’t already)

From a terminal, in the repo folder:

```bash
cd /Users/theo/canvas-mcp
npm install
npm run build
```

You should see no errors and have `dist/index.js`.

---

## 4. [MANUAL] Open Claude Desktop config

- **macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows:** `%APPDATA%\Claude\claude_desktop_config.json`
- **Linux:** `~/.config/Claude/claude_desktop_config.json`

If the file doesn’t exist, create it with contents: `{}`

---

## 5. [MANUAL] Add the canvas-mcp server

**Important:** For Claude Desktop, the token and base URL go in this config file’s `env` block only. A `.env` file in the repo is not read by Claude.

Add a `canvas-lms` entry under `mcpServers` with this shape (use your **absolute** path to the repo and your real token/URL):

```json
"canvas-lms": {
  "command": "node",
  "args": ["/Users/theo/canvas-mcp/dist/index.js"],
  "env": {
    "CANVAS_API_TOKEN": "YOUR_CANVAS_TOKEN_HERE",
    "CANVAS_BASE_URL": "https://canvas.wisc.edu"
  }
}
```

Replace:

- `YOUR_CANVAS_TOKEN_HERE` → your Canvas API token from step 2.
- `https://canvas.wisc.edu` → your school’s Canvas URL if different.
- `/Users/theo/canvas-mcp` → your **absolute** path to the repo (so `dist/index.js` is at `<your-path>/dist/index.js`).

If this is your only MCP, the full file can be:

```json
{
  "mcpServers": {
    "canvas-lms": {
      "command": "node",
      "args": ["/Users/theo/canvas-mcp/dist/index.js"],
      "env": {
        "CANVAS_API_TOKEN": "YOUR_CANVAS_TOKEN_HERE",
        "CANVAS_BASE_URL": "https://canvas.wisc.edu"
      }
    }
  }
}
```

---

## 6. [MANUAL] Restart Claude Desktop

Quit the app completely (e.g. Cmd+Q), then open it again. Config changes only apply after a full restart.

---

## 7. [MANUAL] Verify

1. Start a **new** chat in Claude Desktop.
2. You should see the **tools (hammer)** icon when the MCP is loaded.
3. Ask: **“What’s on my Canvas dashboard?”** or **“List my courses.”**
4. Claude should use Canvas and return real data.

---

## If something goes wrong

- **No tools / MCP not loading** → Use the **absolute** path in `args`. Run `npm run build` and confirm `dist/index.js` exists.
- **“Missing required environment variables”** → Put `CANVAS_API_TOKEN` and `CANVAS_BASE_URL` in the config file’s `env` block for `canvas-lms`, then restart Claude again.
- **JSON error** → No trailing comma after the last key; use `mcpServers` (not `mcp_servers`). Validate at jsonlint.com.

Full runbook and troubleshooting: **[RUNBOOK_CLAUDE_DESKTOP.md](RUNBOOK_CLAUDE_DESKTOP.md)**.
