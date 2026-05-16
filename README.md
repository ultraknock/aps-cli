# aps-cli

A lightweight command-line interface (CLI) starting point for building agent workflows using Autodesk Platform Services (APS) APIs. Designed to be extended (by agents) for specific workflows, it comes bare-bones by design.

## How to Work with an Agent and this CLI

1. Build the CLI (follow steps below).
2. Log in (we recommend using [SSA](https://aps.autodesk.com/en/docs/ssa/v1/developers_guide/overview/))
3. Define a task you would like the agent to do. Keep it small and simple at first. For example `Get the most recent 10 issues from project X`. Keep in mind: An agent can only do what the APS APIs support. Make sure your ask is possible by reviewing the [APS Doc](https://aps.autodesk.com/developer/documentation). To fast-track discovery you can simply ask `How would you do X using the APS CLI, here are the docs: docs/README.md`. Note: the local docs are not complete but include all the scripts on how to crawl new docs. You can also provide URLs to the live APS docs.
4. Grant the CLI needed access to the resources in your task.
5. Prompt the agent using this template:

```
Using the aps-cli, complete the following task:

<DESCRIBE-TASK>

<DESCRIBE-THE-BROADER-WORKFLOW-THIS-TASK-IS-PART-OF>

Resources:
<Hub/project URLs, item IDs, or names from ACC/Forma>

Expected output:
<Describe format — e.g. JSON to stdout, markdown table, summary paragraph>

Not all CLI commands needed for this task may be implemented yet. You have the ability to add and augment the CLI source code. Refer to the APS API documentation `docs/README.md`. Follow the guidance in `AGENTS.md` when changing the source code.
```

From here on, it's up to you to use your knowledge of how to work with coding agents. This repo is designed to fast-track you by providing a framework for the agent to work with, easy access to documentation, and guidance on how to test and self-improve. I wish you luck. If you end up creating a workflow that has value, consider starring this repo.

## [BUILD OPTION 1] Open in a Dev Container

Open the repository in VS Code and run **Dev Containers: Reopen in Container**.
Reference: [containers.dev](https://containers.dev/)
This workspace is configured in `.devcontainer/devcontainer.json`.

## [BUILD OPTION 2] Local Build Requirements (Without Dev Container)

To build this project locally (without the provided dev container), install:

- Node.js 22+
- Git
- Bash-compatible shell (Linux/macOS terminal, or WSL/Git Bash on Windows)

### Install TypeScript Compiler Globally

Install the TypeScript compiler (`tsc`) globally:

```bash
npm install -g typescript
```

## Setup

### 1. Clone Agent Friendly APS Docs & Build

```bash
git clone https://github.com/adskdimitrii/aps-ai-friendly-docs docs
npm install
npm run build
```

### 2. Configure & Log In

#### Option A — Interactive browser login (3-legged OAuth):

[Register a Traditional Web App](https://aps.autodesk.com/en/docs/oauth/v2/tutorials/create-app/) at the [APS Developer Portal](https://aps.autodesk.com/myapps) with:
- **Callback URL**: `http://localhost:7482/callback`

```bash
node ./dist/index.js configure --client-id <YOUR-CLIENT-ID> --client-secret <YOUR-CLIENT-SECRET>
node ./dist/index.js login
```

#### Option B — Import an existing token (3-legged OAuth - for OpenClaw-style agents using YOUR identity OR an Active Directory Service Account):

[Register a Traditional Web App](https://aps.autodesk.com/en/docs/oauth/v2/tutorials/create-app/) at the [APS Developer Portal](https://aps.autodesk.com/myapps) with:
- **Callback URL**: `https://aps-oauth.azurewebsites.net`

Use [https://aps-oauth.azurewebsites.net](https://aps-oauth.azurewebsites.net/) to create an access token. This workflow enables using the CLI with OpenClaw-style agents where the user cannot use the login workflow.

```bash
node ./dist/index.js configure --client-id <YOUR-CLIENT-ID> --client-secret <YOUR-CLIENT-SECRET> --token ~/Downloads/token.json
```

#### Option C — Secure Service Account (SSA - For OpenClaw-style agents using Autodesk Secure Service Account):

[Register a Server-to-Server App](https://aps.autodesk.com/en/docs/oauth/v2/tutorials/create-app/) at the [APS Developer Portal](https://aps.autodesk.com/myapps)

This creates a service account identity tied to your APS application. No browser login required — the CLI generates and signs JWT assertions automatically. Ideal for headless/automated environments.

```bash
node ./dist/index.js configure --client-id <YOUR-CLIENT-ID> --client-secret <YOUR-CLIENT-SECRET> --ssa
```

After running this command, **COPY** the `SSA Email Address` the CLI creates and save it for later.

### 3. Grant APS Access to Forma

#### Grant APS Access

[Add your APS Client ID to your Forma Account](https://aps.autodesk.com/en/docs/acc/v1/tutorials/getting-started/manage-access-to-acc/)

#### Grant SSA Access **[OPTIONAL]**

If using the **SSA** auth option, you must now grant the `SSA Email Address` access to Forma resources just like you would for a user. It's recommended to limit access to the lowest required level.

### Using the APS CLI Manually

```bash
node src/index.js --help
```

If you're using a version of NodeJS that can't run TypeScrip natively use the built `dist/index.js`

### Teaching your Agent to Use the CLI

Edit the path in `skills/aps-cli/SKILL.md` to the full path on your local machine where the `./dist/index.js` is located. Tell the agent to learn this skill as `aps-cli`.

## Design Philosophy

### CLIs over MCPs for Agentic Workflows

MCP servers and CLIs are both wrappers around REST APIs — but CLIs are a more natural fit for AI agents. LLMs are extensively post-trained on shell usage and Unix toolchains, giving them strong intuition for chaining commands, parsing output, and composing scripts to accomplish complex tasks. When an agent understands the goal, it self-implements strategies using the tools it already knows best.

```
  MCP Approach                          CLI Approach
  ────────────                          ────────────

  ┌───────────────────────────┐         ┌───────────────────────────┐
  │        MCP directory      │         │          skill file       │
  │   (built-in tool config)  │         │     (aps-cli/SKILL.md)    │
  └─────────────┬─────────────┘         └─────────────┬─────────────┘
                │  auto-registered                    │  agent reads
                ▼                                     ▼
  ┌───────────────────────────┐         ┌───────────────────────────┐
  │           Agent           │         │           Agent           │
  │        (LLM / AI)         │         │        (LLM / AI)         │
  └─────────────┬─────────────┘         └─────────────┬─────────────┘
                │                                     │
                │  MCP tool call                      │  shell command
                │  (custom protocol)                  │  (stdin / stdout)
                │                                     │
                ▼                                     ▼
  ┌───────────────────────────┐         ┌───────────────────────────┐
  │        MCP Server         │         │            CLI            │
  │  (always-on sidecar proc) │         │    (invoked on demand)    │
  └─────────────┬─────────────┘         └─────────────┬─────────────┘
                │                                     │
                │  HTTP request                       │  HTTP request
                │                                     │
                ▼                                     ▼
  ┌───────────────────────────┐         ┌───────────────────────────┐
  │         REST API          │         │         REST API          │
  └───────────────────────────┘         └───────────────────────────┘
```

Agents naturally reach for scripts and pipelines when a task grows in complexity — and a well-designed CLI meets them there.

#### Chaining Shell Commands

For lightweight tasks, an agent composes a pipeline directly in the shell — piping one command's output into the next to transform and filter data without writing any intermediate files.

```
  Agent
    │
    ├── "List all RFIs marked open in project X and show me the responsible parties"
    │
    ▼
  Shell Pipeline
    │
    ├── aps ls acc://hub/project/rfis          ← list RFI resources
    │       │
    │       ▼ JSON stream of RFIs
    ├── | jq '.[] | select(.status=="open")'   ← filter to open only
    │       │
    │       ▼ filtered RFIs
    └── | jq '{id,title,assignedTo}'           ← project relevant fields
            │
            ▼
         { id: "...", title: "...", assignedTo: "..." }
         { id: "...", title: "...", assignedTo: "..." }
         ...
```

#### Composing Scripts for Complex Tasks

When a task spans multiple steps, branches on results, or needs to be repeated, the agent writes a script. The CLI becomes the building block; the script is the strategy.

```
  Agent
    │
    ├── "Generate a weekly cost-variance report across all active projects"
    │
    ▼
  report.sh (written by agent)
  ┌─────────────────────────────────────────────────────┐
  │ #!/bin/bash                                         │
  │                                                     │
  │ HUBS=$(aps ls acc://)                               │  ← discover hubs
  │                                                     │
  │ for HUB in $HUBS; do                                │
  │   PROJECTS=$(aps ls acc://$HUB)                     │  ← list projects
  │                                                     │
  │   for PROJECT in $PROJECTS; do                      │
  │     BUDGET=$(aps query cost \                       │  ← fetch cost data
  │       --project $PROJECT \                          │
  │       --fields variance,forecast,actual)            │
  │                                                     │
  │     echo "$PROJECT: $BUDGET" >> report.csv          │  ← accumulate
  │   done                                              │
  │ done                                                │
  │                                                     │
  │ aps rfi summarize --input report.csv                │  ← summarize
  └─────────────────────────────────────────────────────┘
            │
            ▼
         report.csv  +  summary.md
```

### Two Agent Deployment Models

A common workflow I see is a local agent is used to develop a APS + Agent workflow, but the ultimate goal is to handoff to a clouded OpenClaw-style agent. This is why the design to support both is important.

**Local agents** (Claude Code, Cursor, VS Code Copilot) run directly on the developer's machine inside the same environment where the CLI lives. The developer clones the repo, builds it once, and the agent has immediate access to both the compiled binary and the TypeScript source. Because the source is co-located, the agent can read it, extend it, and self-test against live APIs without any extra steps.

**OpenClaw-style agents** run remotely — in a cloud sandbox or managed runtime — some enterprise implementations have no persistent filesystem between sessions. They need to install their tools at the start of each session. For these agents, the fact that this CLI is open source is essential: the agent can clone, install, and run the latest version of the CLI as part of its startup sequence, using the provided `skills/install-aps-cli/SKILL.md` skill. This skill teaches the agent exactly how to get the CLI running on a fresh machine before it starts doing real work.

```
  ┌─────────────────────────────────────────────────────────────────────────────────────────┐
  │                                  Agent Deployment Models                                │
  └─────────────────────────────────────────────────────────────────────────────────────────┘

  LOCAL AGENT (Claude Code, Cursor)          OPENCLAW-STYLE AGENT (remote / cloud sandbox)
  ─────────────────────────────────────      ──────────────────────────────────────────────
  Developer Machine                          Session Start
  ┌───────────────────────────────────┐      ┌───────────────────────────────────────────┐
  │                                   │      │                                           │
  │  [manual] git clone <repo>        │      │  [agent] reads                            │
  │         │                         │      │  skills/install-aps-cli/SKILL.md          │
  │         ▼                         │      │         │                                 │
  │  [manual] npm install             │      │         ▼                                 │
  │         │                         │      │  [agent] git clone <open source repo>     │
  │         ▼                         │      │         │                                 │
  │  [manual] give agent              │      │         ▼                                 │
  │  skills/aps-cli/SKILL.md          │      │  [agent] npm install                      │
  │         │                         │      │         │                                 │
  │         ▼                         │      │         ▼                                 │
  │  [agent] reads skill              │      │  [agent] reads                            │
  │  [agent] runs commands            │      │  skills/aps-cli/SKILL.md                  │
  │         │                         │      │         │                                 │
  │         ▼                         │      │         ▼                                 │
  │     live APS API                  │      │  [agent] runs commands                    │
  │                                   │      │         │                                 │
  │  (source co-located,              │      │         ▼                                 │
  │   always current)                 │      │     live APS API                          │
  └───────────────────────────────────┘      │                                           │
                                             │  (zero manual setup — agent installs      │
                                             │   fresh each session via open source)     │
                                             └───────────────────────────────────────────┘
```

The open-source nature of the CLI is what makes the OpenClaw workflow viable. A closed binary would require a versioned release and a download URL; an open repo means the agent always gets the latest source in one `git clone`.

### Non-Compiled CLI Works Even Better

By not compiling the CLI, the agent using Node on the host machine can read the CLI source code for additional context. This is an interesting emergent quality of having agents use tools. We try to provide all of the human-readable context via the `--help`, but once the agent sees the CLI is just source code, it will read the source code for further context — nuance that the `--help` text may have omitted.

A more controversial benefit is self-healing. This is where the agent, after reading the source code and using the CLI, determines there might be a bug in the code or that it needed to add a feature. One story from the field: I gave this CLI to a customer and the agent quickly figured out that the reason the CLI wasn't working on their network was a firewall rule on their laptop. It did some research about that particular firewall software, found that adding a specific header to the traffic would allow it through, and patched the CLI.

### Credential Isolation

Once a user authenticates, the agent should never need to see the OAuth token. The CLI handles credential storage, refresh, and injection transparently. Sensitive values are encrypted at rest and never surfaced in command output.

```
  Human                CLI                  APS API
    │                   │                      │
    ├──── aps login ───►│                      │
    │◄─── (browser) ────┤                      │
    │                   ├──── store token ─────┤
    │                   │     (encrypted)      │
    │                   │                      │
  Agent               CLI                  APS API
    │                   │                      │
    ├── aps query .. ──►│                      │
    │                   ├── inject token ─────►│
    │◄────── data ──────┤◄──────── data ───────┤
    │                   │                      │
    │  (token never     │
    │   visible here)   │
```

The boundary between "human authenticates" and "agent operates" is a key security property of this design.

SSA (Secure Service Account) takes this isolation a step further. Rather than delegating a human user's identity to the agent, SSA creates a dedicated service identity — scoped to your APS application — that can be granted access to Forma resources independently. The agent authenticates as this service account using JWT assertions signed by a private key managed by the CLI; no user credentials or browser session are ever involved. Because the SSA identity exists separately from any human account, its access can be provisioned at the minimum required permission level and revoked without affecting any user. This makes SSA the recommended option for production agentic workflows where strong credential isolation and auditability are required.

```
  APS Application
    │
    └── SSA Identity (service account email)
          │
          ├── Provisioned to Forma Hub
          │     │
          │     └── Granted project-level access (e.g. viewer only)
          │           │
          │           └── Agent operates within this scope
          │                 (cannot exceed granted permissions)
          │
          └── Revocable independently of any human user at hub or project-level
```

### A Minimal, Focused Interface

Real-world use cases vary. A project manager, a cost engineer, and an automation developer all need different vocabulary from the same underlying API. This CLI is designed to be augmented — help text, commands, and output can be tailored to the business domain of the agent's task.

Since coding agents excel at extending CLIs given API documentation, missing functionality is typically one prompt away. The framework eliminates boilerplate, so every augmentation starts from a working foundation:

```
Base CLI (this repo)
    │
    ├── aps ls          ← navigate ACC file structure
    ├── aps query       ← run AEC Data Model GraphQL queries
    └── ...
    │
    ▼ Agent augments for domain-specific task
    │
    ├── aps cost        ← (generated from cost API docs)
    ├── aps assets      ← (generated from assets API docs)
    └── aps <whatever>  ← one prompt, no boilerplate
```

The result is a CLI that is both immediately useful and fluid enough to grow with the task.

Fewer commands mean a cleaner context window. From experience, agent performance on complex tasks improves as the interface simplifies — extraneous commands dilute the signal of what's actually useful. This CLI ships only what's needed to navigate APS data; nothing more.

### Agent Self-Testing Enables Better & Faster CLI Extension

When an agent extends this CLI, there is no barrier to real, end-to-end testing — not just unit tests. The development loop:

1. The agent writes or edits TypeScript source.
2. It checks for lint and type errors immediately (`eslint` + `tsc --noEmit`).
3. Once those pass, it runs the CLI directly with `node src/index.ts <command>`.
4. It inspects the live output, iterates, and verifies the feature works against real APS APIs.

No build step is required. Node 22+ runs TypeScript natively, so the agent goes from source edit to live test in seconds. This keeps the feedback loop fast and keeps the agent honest — it cannot ship code it hasn't actually run.

```
  ┌─────────────────────────────────────────────────────────┐
  │              Agent Development Loop                     │
  └─────────────────────────────────────────────────────────┘

    ┌───────────────────────────────────────────────────────┐
    │                                                       │
    ▼                                                       │
        ┌──────────────┐                                    │
        │  Write / Edit│                                    │
        │  TypeScript  │                                    │
        └──────┬───────┘                                    │
               │                                            │
               ▼                                            │
        ┌──────────────┐        errors                      │
        │  tsc --noEmit│ ───────────────────────────────────┤
        │  eslint      │                                    │
        └──────┬───────┘                                    │
               │ clean                                      │
               ▼                                            │
        ┌──────────────┐        fails                       │
        │  node        │ ───────────────────────────────────┤
        │  src/index.ts│  (runtime / API error)             │
        │  <command>   │                                    │
        └──────┬───────┘                                    │
               │ passes                                     │
               ▼                                            │
        ┌──────────────┐        bugs found                  │
        │  Verify live │ ───────────────────────────────────┘
        │  output      │  (logic / behavior error)
        └──────┬───────┘
               │ correct
               ▼
            done
```

### Local Documentation Chain

To prevent context overload, we present documentation in small pieces with a choose-your-own-adventure approach. Most context can be explained in the `--help`, but for some commands you need dedicated documentation commands.

The docs are kept local because some enterprise implementations of agents do not allow searching the web. Most of us are accustomed to having Claude or Cursor read the web, but note that in enterprise environments these features could be blocked.

The AEC Data Model docs illustrate this well. Over 100 markdown files covering tutorials, GraphQL query references, object types, and input types live under `docs/aecdatamodel/`. Rather than injecting all of that into context at once, the agent starts with a lightweight index:

```
node ./dist/index.js query-docs
```

```
Getting Started
───────────────
  Get Hubs
    /workspaces/aps-cli-opensource/docs/aecdatamodel/how-to-docs/tutorial01-gethubs.md
  Get Projects
    /workspaces/aps-cli-opensource/docs/aecdatamodel/how-to-docs/tutorial01-getprojects.md
  Navigate to ElementGroups within a Project
    /workspaces/aps-cli-opensource/docs/aecdatamodel/how-to-docs/tutorial01-nav-elements.md
  Get Elements from a Category
    /workspaces/aps-cli-opensource/docs/aecdatamodel/how-to-docs/tutorial01-elementsbycategory.md

Working with Advanced Queries
─────────────────────────────
  ...

```

The output is a map — category names, doc titles, and absolute file paths — with no content loaded yet. The agent scans it, identifies the one or two files relevant to the task, and reads only those. A query about filtering elements by category touches two files; a question about pagination touches one. The other 100+ files never enter the context window.

## Pull Requests

Sure. As long as it's within the Design Philosophy.

Things we could improve:
- Configure & Login UX / AX (agent experience)
- ...

## MIT License

See [LICENSE](LICENSE) for details.
