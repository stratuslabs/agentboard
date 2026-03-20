# AgentBoard CLI

Lightweight project management for agents and humans.

## Install

```bash
npm install -g @stratuslabs/agentboard
```

## Setup

```bash
export AGENTBOARD_URL=https://your-instance.vercel.app
export AGENTBOARD_PASSWORD=your-password  # if auth is enabled
export AGENTBOARD_AGENT_NAME=MyAgent      # auto-registers as agent member
```

## Usage

```bash
# Organizations
agentboard org list
agentboard org add "My Org"

# Products
agentboard product list
agentboard product add --org my-org "My Product"

# Tasks
agentboard task add --product my-product --board development "Build login page"
agentboard task add --product my-product --board development "Fix bug" --priority high --assignee "Claudia"
agentboard task list --product my-product --board development
agentboard task move <id> --column in-progress
agentboard task done <id>

# Board view
agentboard board --product my-product --board development

# Members
agentboard member list
agentboard member add "Dylan" --type human
agentboard member add "Claudia" --type agent

# My tasks
agentboard my-tasks --assignee "Claudia"
```

## Agent Integration

Set `AGENTBOARD_AGENT_NAME` and the CLI will automatically register the agent as a member on first use.

## Output

- `--json` — JSON output
- `--quiet` — IDs only
