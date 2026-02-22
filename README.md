# TabHR — OpenClaw (Docker / digital employee)

This is a **slimmed OpenClaw fork** for running the gateway as a **digital employee** in a Linux Docker container (e.g. for TabHR).

- **Removed:** macOS/iOS/Android apps, installers, full docs, and scripts that are only needed for native apps or full upstream CI.
- **Kept:** Core CLI, gateway, extensions, UI build, and the minimal `apps/shared/OpenClawKit/Tools/CanvasA2UI` + `vendor/a2ui` needed to build the A2UI bundle.

## Quick start (Docker)

See **[docs/README.md](docs/README.md)** for:

- Building the image (including `vendor/a2ui` requirement)
- Running the gateway in a container
- Persisting config and using the Control UI

## Build and run locally (Linux)

Requires **Node ≥22** and **pnpm**.

```bash
pnpm install
pnpm build
node openclaw.mjs gateway --allow-unconfigured
```

Configure via `openclaw onboard` or by copying an existing `~/.openclaw` (or set `OPENCLAW_HOME`).

## Upstream

Based on [OpenClaw](https://github.com/openclaw/openclaw). License: MIT.
