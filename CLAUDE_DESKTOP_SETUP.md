# Installing canvas-mcp in Claude Desktop

Follow these steps to use this MCP server with the Claude Desktop app.

**Quick link:** For a step-by-step runbook with troubleshooting, see **[docs/RUNBOOK_CLAUDE_DESKTOP.md](docs/RUNBOOK_CLAUDE_DESKTOP.md)**.

## 1. Prerequisites

- **Node.js 18+** installed
- **Claude Desktop** app installed
- Canvas API token and your Canvas base URL (e.g. `https://canvas.wisc.edu`)

## 2. Build the project (if you haven’t already)

From this repo directory:

```bash
cd /Users/theo/canvas-mcp
npm install
npm run build
```

## 3. Get your Canvas API token

1. Log in to Canvas (e.g. canvas.wisc.edu).
2. Go to **Account → Settings** (profile icon → Settings).
3. Scroll to **Approved Integrations**.
4. Click **+ New Access Token**.
5. Set a purpose (e.g. “Claude MCP”) and expiry, then create and **copy the token** (you won’t see it again).

## 4. Edit Claude Desktop config

- **macOS:**  
  `~/Library/Application Support/Claude/claude_desktop_config.json`

- Or in Claude Desktop: **Settings → Developer → Edit Config**.

If the file doesn’t exist, create it with `{}`. You must have an `mcpServers` object.

## 5. Add the canvas-mcp server

**Important:** For Claude Desktop, the token and base URL go in this config file’s `env` block only. A `.env` file in the repo is not read by Claude Desktop.

In `claude_desktop_config.json`, add a `canvas-lms` entry under `mcpServers`. Use `"command": "node"` and `"args": ["<absolute-path-to-repo>/dist/index.js"]` (replace with your actual path). Use your **real** token and Canvas URL in `env`.

**If this is your only MCP server:**

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

**If you already have other servers**, add only the `canvas-lms` block inside `mcpServers`:

```json
"mcpServers": {
  "some-other-server": { ... },
  "canvas-lms": {
    "command": "node",
    "args": ["/Users/theo/canvas-mcp/dist/index.js"],
    "env": {
      "CANVAS_API_TOKEN": "YOUR_CANVAS_TOKEN_HERE",
      "CANVAS_BASE_URL": "https://canvas.wisc.edu"
    }
  }
}
```

Replace:

- `YOUR_CANVAS_TOKEN_HERE` with your Canvas API token.
- `https://canvas.wisc.edu` with your school’s Canvas URL if different.

Optional: to enable write tools (submit assignments, post to discussions), add to `env`:

```json
"ENABLE_WRITE_TOOLS": "true"
```

## 6. Restart Claude Desktop

Quit the app completely (e.g. Cmd+Q), then open it again. Restarting is required for config changes.

## 7. Verify

- In Claude Desktop, look for the **tools** (hammer) icon in the chat input.
- Start a new chat and ask something like: “What’s on my Canvas dashboard?” or “List my courses.”
- If Claude can use the Canvas tools, the MCP is running correctly.

## Troubleshooting

- **“Missing required environment variables”**  
  Check that `CANVAS_API_TOKEN` and `CANVAS_BASE_URL` are set correctly in the `env` block and that you restarted Claude Desktop.

- **No tools / server not loading**  
  Confirm the path in `args` is correct: `/Users/theo/canvas-mcp/dist/index.js`. Run `npm run build` again if needed.

- **Invalid token**  
  Generate a new token in Canvas and update `CANVAS_API_TOKEN` in the config.
