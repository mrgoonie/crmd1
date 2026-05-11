# crmx — Claude skill for crmd1

A Claude Code skill that teaches Claude to drive the `crmd1` CLI for:

- **Task Management** — create, list, complete tasks (with optional entity links)
- **Customer Management** — contacts and their lifecycle (`prospect → active → churned`)
- **Agency / Partner Management** — companies segmented via `--industry`
- **Company Member Management** — contacts linked to a company via `--company-id`

## Install via Claude Plugins Marketplace

From inside any Claude Code session:

```
/plugin marketplace add mrgoonie/crmd1
/plugin install crmx@crmd1
```

Or, when developing locally inside this repo:

```
/plugin marketplace add .
/plugin install crmx@crmd1
```

After install, restart Claude Code. The skill auto-activates when you mention `crmd1`, "create contact", "list tasks", "onboard agency", etc.

## Prerequisites

- `crmd1` CLI installed globally: `npm i -g crmd1`
- `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` set in the environment
- An active org: `crmd1 org create <slug> && crmd1 org use <slug> && crmd1 db init`

## Contents

- `skills/crmx/SKILL.md` — main instructions
- `skills/crmx/references/cli-cheatsheet.md` — one-page command map
- `skills/crmx/references/schema.md` — entity field reference
