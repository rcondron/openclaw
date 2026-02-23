# TabHR — OpenClaw in Docker

This fork is trimmed to run **OpenClaw as a digital employee** in a Linux Docker container (e.g. for TabHR).

## Build the image

**Requirements:** Node 22+, pnpm. For the A2UI bundle build you need either:

- The `vendor/a2ui` tree (copy from upstream openclaw or ensure it exists before build), or  
- A pre-built `src/canvas-host/a2ui/a2ui.bundle.js` (build once from a full openclaw clone, then copy here).

```bash
pnpm install
pnpm build
docker build -t tabhr-openclaw .
```

## Run the gateway

Default command runs the gateway bound to loopback:

```bash
docker run -d --name tabhr-gateway -p 18789:18789 tabhr-openclaw
```

For LAN or external access (e.g. health checks), override the command:

```bash
docker run -d --name tabhr-gateway -p 18789:18789 \
  -e OPENCLAW_GATEWAY_TOKEN=your-token \
  tabhr-openclaw \
  node openclaw.mjs gateway --allow-unconfigured --bind lan
```

## Configure

- Config and state live in `~/.openclaw` (or `OPENCLAW_HOME`). Mount a volume to persist:
  ```bash
  docker run -d -p 18789:18789 -v openclaw-data:/home/node/.openclaw tabhr-openclaw
  ```
- First-time setup: run the onboarding wizard from a host that can reach the container, or copy an existing `~/.openclaw` from another OpenClaw install.

This fork has no web Control UI; the gateway runs headless. Use the CLI (`openclaw` commands) or your channels to interact with the digital employee.

**Browser:** The default browser profile `chrome` connects to the **TabHR browser extension** at `http://127.0.0.1:9220`. The extension uses a JSON envelope API (not CDP): the gateway sends commands like `{ "requestId", "endpoint", ...params }` (e.g. `status`, `navigate`, `click`, `type`, `screenshot`, `evaluate`) and receives `{ "success", "data" | "error", "requestId" }`. Ensure the TabHR extension is running on that port. Use `openclaw browser extension url` to print the URL.
