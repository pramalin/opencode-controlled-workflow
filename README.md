# Controlled OpenCode Workflow

Copyright © 2026 Alai Engineering

A safety-first, human-controlled workflow for using OpenCode with a local LLM on an existing source repository.

The design deliberately separates **understanding code** from **changing code**:

- the real repository is mounted read-only;
- normal chat can inspect source but cannot create changes or inspect Git state;
- `/prepare` may write only to an external numbered bundle tree;
- bundles contain complete files, not patches;
- the human applies bundles, reviews Git changes, builds, tests, stages, commits, and pushes;
- `/finalize` gets narrow read-only Git inspection plus optional documentation-bundle authority;
- `/committed` can report only the scoped post-commit cleanup command.

> **Independent project:** this repository is not built by, endorsed by, or affiliated with the OpenCode team. OpenCode itself is available at <https://github.com/anomalyco/opencode>.

## Why this exists

Most coding-agent setups optimize for autonomy. This one optimizes for a different goal:

> **Give the model broad read access for engineering reasoning while keeping mutation authority narrow, explicit, and reversible.**

OpenCode permission rules are policy controls, but they are not the security boundary here. Docker additionally mounts the source repository read-only. The model can inspect the code and prepare proposed changes, but it cannot directly write into the real working tree.

## Architecture and authority

```text
Human ↔ OpenCode + local LLM ──read-only──> /root/repo
                    │
                    └──controlled writes──> /bundle
```

The important boundary is the filesystem:

```text
/root/repo   read-only source repository
/bundle      writable generated bundles
```

| Mode | Read repo | Git inspect | Write bundle | Shell/edit repo | Intended use |
|---|---:|---:|---:|---:|---|
| normal `controlled` chat | yes | no | no | no | design, review, debugging discussion |
| `/prepare` | yes | no | yes | no | create one immutable implementation bundle |
| `/finalize` | yes | fixed read-only operations | docs bundle only if needed | no | review tested state and produce commit guidance |
| `/committed` | yes | fixed read-only operations | cleanup information only | no | verify commit and print scoped cleanup command |

The source repository remains mounted `:ro` in every mode.

## Prerequisites

- Docker Engine with Docker Compose
- a source repository on the host
- an OpenAI-compatible local LLM endpoint reachable from the container
- `rsync` on the host for applying bundles
- optionally, OpenCode CLI and the OpenCode extension inside WSL for VS Code integration

The included defaults were validated with:

- OpenCode `1.18.16`
- `@opencode-ai/plugin` `1.18.16`
- Qwen 3.5 through an OpenAI-compatible endpoint
- 65,536-token context and 4,096-token output limits

The OpenCode image and plugin versions should remain compatible. Do not combine an unverified `latest` OpenCode image with the pinned plugin and assume compatibility.

## Initial setup

### 1. Configure the environment

```bash
cp .env.example .env
```

Edit `.env`:

```text
REPO_PATH=/absolute/path/to/your/repository
BUNDLE_ROOT=/absolute/path/to/opencode-bundles
HOST_GID=<output of id -g>

QWEN_BASE_URL=http://host.docker.internal:8000/v1
QWEN_MODEL_ID=qwen/qwen3.5
QWEN_API_KEY=local
QWEN_CONTEXT_LENGTH=65536
QWEN_OUTPUT_TOKENS=4096

OPENCODE_PORT=4096
OPENCODE_SERVER_USERNAME=opencode
OPENCODE_SERVER_PASSWORD=<long-random-password>

# Keep this aligned with config/package.json.
OPENCODE_IMAGE=ghcr.io/anomalyco/opencode:1.18.16
```

`REPO_PATH` and `BUNDLE_ROOT` must be absolute host paths. The Web UI is bound to `127.0.0.1`, so it is not directly exposed to the LAN.

If you intentionally upgrade OpenCode, validate the custom configuration and update `config/package.json` to a compatible plugin version.

### 2. Prepare the bundle directory

```bash
mkdir -p /absolute/path/to/opencode-bundles
chgrp "$(id -gn)" /absolute/path/to/opencode-bundles
chmod 2775 /absolute/path/to/opencode-bundles
```

If the directory is not owned by your account, use appropriate elevated permissions for the one-time ownership or mode change.

### 3. Build and create the container

```bash
docker compose up --build -d opencode
docker compose ps
```

`docker compose restart` is not an initial-start command. It restarts an existing container but does not build an image or create a missing container.

### 4. Install the pinned plugin dependency

The custom tools import `@opencode-ai/plugin`. Install it into the writable configuration mount:

```bash
docker compose exec opencode sh -lc '
npm_config_cache=/tmp/npm-cache \
npm install \
  --prefix /root/.config/opencode \
  --omit=dev \
  --no-audit \
  --no-fund \
  --package-lock=false
'
```

Then restart OpenCode so it loads the complete configuration cleanly:

```bash
docker compose restart opencode
```

If the web process cannot remain running long enough for `docker compose exec`, use a one-off container:

```bash
docker compose run --rm --no-deps \
  --entrypoint sh opencode -lc '
npm_config_cache=/tmp/npm-cache \
npm install \
  --prefix /root/.config/opencode \
  --omit=dev \
  --no-audit \
  --no-fund \
  --package-lock=false
'

docker compose up -d opencode
```

### 5. Verify the server

```bash
docker compose ps

curl -fsS -u 'opencode:<your-password>' \
  http://127.0.0.1:4096/global/health
```

Open the Web UI at <http://127.0.0.1:4096> and authenticate with the username and password from `.env`.

In the Web UI, verify that:

- the provider/model is **Local Qwen**;
- the selected agent is **controlled**;
- the project path is `/root/repo`.

Inspect the loaded provider limits with:

```bash
curl -fsS -u 'opencode:<your-password>' \
  http://127.0.0.1:4096/provider | jq
```

For the included baseline, the relevant model entry should report:

```json
{
  "context": 65536,
  "output": 4096
}
```

## Daily operation

### Start or recreate OpenCode

Use this command after a reboot or whenever the container does not exist:

```bash
docker compose up -d opencode
```

If the Dockerfile, Compose file, `.env`, base image, or dependency setup changed:

```bash
docker compose up --build -d opencode
```

### Check status

```bash
docker compose ps
```

To include stopped containers:

```bash
docker compose ps -a
```

An image shown by `docker image ls` only proves that an image exists. It does not mean a container has been created or is running.

### Stop without deleting state

```bash
docker compose stop opencode
```

Start it again with:

```bash
docker compose start opencode
```

### Restart an existing container

```bash
docker compose restart opencode
```

Use `restart` only when the service container already exists.

## VS Code and WSL

The VS Code extension normally launches OpenCode in an integrated terminal. Running plain `opencode` in WSL creates a separate OpenCode server with WSL-local configuration and state. That separate process does **not** automatically inherit this project's Docker mounts, controlled agents, custom tools, or safety boundary.

To preserve this controlled workflow, attach the WSL CLI to the existing Docker server.

### 1. Open the real repository in VS Code through WSL

Open `${REPO_PATH}` in a VS Code window connected to WSL. The IDE edits the real host working tree, while the container sees the same repository at `/root/repo:ro`.

### 2. Attach from the integrated terminal

```bash
OPENCODE_SERVER_USERNAME=opencode \
OPENCODE_SERVER_PASSWORD='<your-password>' \
opencode attach http://127.0.0.1:4096 --dir /root/repo
```

The `--dir` value is deliberately `/root/repo`, not the WSL host path. It is interpreted by the OpenCode server running inside the container.

After attachment, verify that the terminal displays **Local Qwen** and the **controlled** agent.

### 3. Optional shell helper

Add a function to your WSL shell profile so the password is not duplicated in shell history:

```bash
opencode-controlled() {
  OPENCODE_SERVER_USERNAME="${OPENCODE_SERVER_USERNAME:-opencode}" \
  OPENCODE_SERVER_PASSWORD="${OPENCODE_SERVER_PASSWORD:?Set OPENCODE_SERVER_PASSWORD first}" \
  opencode attach http://127.0.0.1:4096 --dir /root/repo
}
```

Then set the password in your current shell and attach:

```bash
export OPENCODE_SERVER_PASSWORD='<your-password>'
opencode-controlled
```

Avoid placing a real password in a versioned file.

### 4. Extension shortcuts

On Windows/Linux, the OpenCode extension provides:

- `Ctrl+Esc` — open or focus OpenCode in a split terminal;
- `Ctrl+Shift+Esc` — start a new OpenCode terminal session;
- `Alt+Ctrl+K` — insert a reference to the current file or selection.

Be careful with commands that start a new session: confirm that the resulting terminal is attached to the Docker server and shows **Local Qwen** and **controlled**. If it launched plain `opencode`, exit it and use `opencode attach` explicitly.

## Using the controlled workflow

### Discuss

Use ordinary chat for architecture, code review, debugging, and design. Normal chat may read the repository but cannot create a bundle.

Messages such as `proceed`, `implement it`, or `make the change` do not grant mutation authority.

### Prepare

When the design is ready:

```text
/prepare mapping-memory
```

The hidden prepare agent re-reads the current repository and creates exactly one new complete-file bundle. The current filesystem is authoritative; earlier bundles are never assumed to have been fully applied.

### Review, apply, build, and test

A bundle is created under the host directory configured by `BUNDLE_ROOT`, for example:

```text
mapping-memory/
  001/
    files/
    metadata.json
    manifest.md
```

Apply it manually using the `rsync -av` command recorded in `manifest.md`, for example:

```bash
rsync -av -- \
  '/path/to/opencode-bundles/mapping-memory/001/files/' \
  '/path/to/repository/'
```

Never add `--delete`. Deletions and rename-source removals are recorded separately for manual review.

Review the real Git changes in the IDE, then run the build and tests yourself. If a correction is required, discuss the evidence and run the same work label again:

```text
/prepare mapping-memory
```

This creates `002`; it never overwrites `001`.

### Finalize

After the implementation passes your tests:

```text
/finalize mapping-memory
```

Finalization can inspect Git only through fixed read-only operations. It may create a final documentation bundle when documentation is materially affected and returns explicit staging and commit guidance. It never stages or commits.

### Committed

After the human commit succeeds:

```text
/committed mapping-memory
```

This phase verifies post-commit status/history and prints a cleanup command scoped to that work label. It never runs the cleanup itself.

## Troubleshooting

### Connection refused on port 4096

Check whether a container exists and whether it exited:

```bash
docker compose ps -a
docker compose logs --tail=200 opencode
```

If no container exists, create it:

```bash
docker compose up --build -d opencode
```

If it exits again, inspect the logs before retrying repeatedly.

### Container exists but is stopped

```bash
docker compose start opencode
docker compose logs --tail=100 opencode
```

### Port 4096 is already in use

Identify the listener:

```bash
ss -ltnp | grep ':4096'
```

Either stop the conflicting process or change `OPENCODE_PORT` in `.env`. The container continues to listen on port `4096`; only the host-side port changes.

### Authentication fails

Confirm the values Compose resolved without printing the password unnecessarily:

```bash
docker compose config | grep -E 'OPENCODE_SERVER_USERNAME|OPENCODE_PORT'
```

After changing `.env`, recreate the container:

```bash
docker compose up -d --force-recreate opencode
```

### OpenCode starts but the plugin or custom tools fail

Check the running OpenCode version:

```bash
docker compose run --rm --no-deps opencode --version
```

Compare it with `config/package.json`. Reinstall dependencies using the one-off installation command in the setup section, then recreate the service.

### Local Qwen is unavailable

The endpoint in `QWEN_BASE_URL` is evaluated from inside the container. When the model server runs on the Docker host, use `host.docker.internal`, not `127.0.0.1`.

Test host-name resolution and endpoint reachability from the service container:

```bash
docker compose exec opencode sh -lc \
  'getent hosts host.docker.internal && wget -S -O- http://host.docker.internal:8000/v1/models'
```

Adjust the port and path for your model server. If the endpoint requires an API key, supply it through `QWEN_API_KEY`.

### VS Code shows another provider or agent

The extension probably launched a separate WSL OpenCode instance. Exit that terminal and explicitly attach to the Docker service:

```bash
OPENCODE_SERVER_USERNAME=opencode \
OPENCODE_SERVER_PASSWORD='<your-password>' \
opencode attach http://127.0.0.1:4096 --dir /root/repo
```

### Inspect the effective Compose configuration

```bash
docker compose config
```

Review paths, port mapping, image, UID/GID, and environment substitution. Treat the output as potentially sensitive because it may include secrets.

## Safety controls

The controls are layered:

1. `${REPO_PATH}` is physically mounted at `/root/repo:ro`.
2. The container root filesystem is read-only; only explicit state, configuration, bundle mounts, and `/tmp` are writable.
3. The primary `controlled` agent denies bundle tools and Git inspection.
4. Hidden workflow agents receive only the custom tools needed for their phase.
5. Built-in Bash, edit, LSP, web, and general task/subagent authority are denied.
6. `git_inspect` accepts only fixed read-only operations, not arbitrary commands.
7. Bundle paths reject absolute paths, `..`, and `.git`.
8. Completed bundles are immutable; corrections create the next number.
9. The human applies changes, reviews Git, builds, tests, stages, commits, pushes, and deletes bundles.

The model can still generate incorrect code. This project constrains **authority**, not correctness.

## Why `/root/repo`?

OpenCode Web's project picker naturally operates beneath the container user's home directory. Mounting the source at `/root/repo` keeps it easy to select while preserving the Docker `:ro` boundary.

## Why is `./config` writable?

OpenCode creates configuration-side runtime/package files, and the custom tools need their plugin dependency under that tree. The configuration bind mount is therefore writable and ignored by Git where appropriate.

That does not make the source writable:

```text
./config     → writable OpenCode configuration/runtime state
/root/repo   → separate read-only source bind mount
```

## Tested context limits

A repository-scale read-only review completed at 64K without forced compaction. During validation:

```text
32K context + 8192 output → context exhausted
32K context + 4096 output → context exhausted
64K context + 4096 output → review completed
```

This is an observed result for that workload, model, and repository—not a universal minimum.

## Repository contents

```text
.
├── .dockerignore
├── .env.example
├── .gitignore
├── Dockerfile
├── LICENSE
├── README.md
├── compose.yaml
└── config/
    ├── opencode.json
    ├── package.json
    ├── agents/
    ├── commands/
    └── tools/
```

Runtime files created under `config/`, such as `node_modules/` and OpenCode's generated `.gitignore`, are intentionally excluded from version control.

## Non-goals

This repository intentionally does not:

- let the model edit the real source tree;
- let the model run builds, tests, formatters, or package managers;
- let the model stage, commit, or push;
- apply patches automatically;
- clean bundle history automatically;
- promise that generated code is correct.

The point is **useful local-model assistance with explicit, reviewable handoffs back to the human**.

## License

Licensed under the Apache License 2.0. See [LICENSE](LICENSE) for the full text.
