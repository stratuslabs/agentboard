# AgentBoard CLI

Lightweight project management for agents and humans.

## Install

```bash
npm install -g agentboard
```

## Setup

```bash
export AGENTBOARD_URL=https://your-instance.vercel.app
export AGENTBOARD_PASSWORD=your-password  # if auth is enabled
export AGENTBOARD_AGENT_NAME=MyAgent      # auto-registers as agent member
```

## Usage

```bash
# List tasks
agentboard list
agentboard list --include-done

# Create a task
agentboard new "Build login page"
agentboard new "Fix bug" --auto-title

# Update status (todo | doing | done | blocked)
agentboard status <id> doing
agentboard status <id> done

# View task details
agentboard show <id>

# Rename a task
agentboard rename <id> "New title"

# Manage notes
agentboard notes <id>                    # view notes
agentboard notes <id> --set "Full text" # replace notes
agentboard notes <id> --append "More"   # append to notes

# Toggle attention flag
agentboard attention <id> on
agentboard attention <id> off
```

## Agent Integration

Set `AGENTBOARD_AGENT_NAME` and the CLI will automatically register the agent as a member on first use.

## Output

- `--json` — JSON output
- `--quiet` — IDs only
