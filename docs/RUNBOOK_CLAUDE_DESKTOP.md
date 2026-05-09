# Runbook: Get canvas-mcp online in Claude Desktop

Follow these steps to run the Canvas MCP server inside the Claude Desktop app. **[MANUAL]** marks steps you must do yourself.

---

## 1. Prerequisites [MANUAL]

- **Node.js 18+** — Install from [nodejs.org](https://nodejs.org) or your package manager.
- **Claude Desktop** — Install from [claude.ai](https://claude.ai) or your app store.
- **Canvas account** — You need a Canvas LMS account (e.g. canvas.wisc.edu) and the ability to create an API token.

---

## 2. Clone or open the repo [MANUAL]

- If you haven’t already: clone or download the repo and `cd` into it.
- Example path used in this runbook: **`/Users/theo/canvas-mcp`**. If your path is different, replace it everywhere below (especially in the config JSON).

---

## 3. Install and build [MANUAL]

In a terminal, from the repo directory:

```bash
cd /Users/theo/canvas-mcp
npm install
npm run build
```

- **Success:** No errors; `dist/index.js` exists. If you see "Missing required environment variables" when you run the server alone, that’s expected until you add credentials in Claude’s config (next steps).

---

## 4. Get your Canvas API token [MANUAL]

1. Log in to Canvas (e.g. canvas.wisc.edu).
2. Go to **Account → Settings** (profile icon → Settings).
3. Scroll to **Approved Integrations**.
4. Click **+ New Access Token**.
5. Set a purpose (e.g. “Claude MCP”) and expiry; create the token.
6. **Copy the token** — you won’t be able to see it again.

---

## 5. Locate the Claude Desktop config file [MANUAL]

The config file path depends on your OS:

| OS      | Path |
|---------|------|
| **macOS**   | `~/Library/Application Support/Claude/claude_desktop_config.json` |
| **Windows** | `%APPDATA%\Claude\claude_desktop_config.json` |
| **Linux**   | `~/.config/Claude/claude_desktop_config.json` |

- **If the file doesn’t exist:** Create it with contents `{}`, then add an `mcpServers` object (see next step).

---

## 6. Add canvas-mcp to the config [MANUAL]

**Important:** For Claude Desktop, the token and base URL go in this config file’s `env` block only. A `.env` file in the repo is **not** read by Claude Desktop.

Open the config file and add a `canvas-lms` entry under `mcpServers`. Use this exact shape:

- **`command`:** must be `"node"`.
- **`args`:** must be a **one-element array** with the **absolute** path to `dist/index.js` in your repo.

**Example (macOS, path `/Users/theo/canvas-mcp`):**

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

- Replace **`YOUR_CANVAS_TOKEN_HERE`** with your Canvas API token.
- Replace **`https://canvas.wisc.edu`** with your school’s Canvas URL if different.
- Replace **`/Users/theo/canvas-mcp`** in `args` with your **absolute** path to the repo (e.g. `/home/you/canvas-mcp` on Linux, or `C:\Users\You\canvas-mcp` on Windows — use forward slashes or escaped backslashes as required by JSON).

If you already have other servers, add only the `"canvas-lms": { ... }` block inside your existing `mcpServers` object.

**Optional:** To enable submission and discussion write tools, add to `env`:

```json
"ENABLE_WRITE_TOOLS": "true"
```

---

## 7. Restart Claude Desktop [MANUAL]

Config changes take effect only after a **full quit and reopen** of Claude Desktop (e.g. Cmd+Q then reopen). Closing the window is not enough.

---

## 8. Verify [MANUAL]

1. Open Claude Desktop and start a **new** chat.
2. You should see the **tools (hammer)** icon in the chat input when the MCP is loaded.
3. Ask: **“What’s on my Canvas dashboard?”** or **“List my courses.”**
4. Claude should use Canvas tools and return real data. If it says it doesn’t have access or can’t use tools, the MCP likely didn’t load — see Troubleshooting.

---

## 9. Troubleshooting

| Problem | What to do |
|--------|------------|
| **Config file doesn’t exist** | Create the file with contents `{}`, then add `"mcpServers": { ... }` with your server entry (see step 6). |
| **No tools / server not loading** | Use the **absolute** path to `dist/index.js` in `args` (e.g. `/Users/you/canvas-mcp/dist/index.js`). Run `npm run build` and confirm `dist/index.js` exists. |
| **JSON syntax error** | Check for a **trailing comma** after the last key in an object. Use the key **`mcpServers`** (not `mcp_servers`). Validate JSON (e.g. paste into a JSON validator). |
| **“Missing required environment variables”** | Ensure `CANVAS_API_TOKEN` and `CANVAS_BASE_URL` are set inside the `env` block for this server in the config file, then **fully restart** Claude Desktop. |
| **Invalid token** | Generate a new token in Canvas (Account → Settings → Approved Integrations) and update `CANVAS_API_TOKEN` in the config. |

For more detail, see **[CLAUDE_DESKTOP_SETUP.md](../CLAUDE_DESKTOP_SETUP.md)** in the repo root. For a quick overview from the repo root, see **README.md**.
