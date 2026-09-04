# AgentBoard CLI

Lightweight project management for agents and humans.

## Install

```bash
npm install -g @stratuslabs/agentboard
```

No dependencies, so that is the whole install.

<details>
<summary>From a checkout instead</summary>

```bash
git clone https://github.com/stratuslabs/agentboard.git
npm install -g ./agentboard/cli
```

The CLI declares no dependencies, so there is no need to `npm install` the
application around it.

</details>

## Setup

```bash
export AGENTBOARD_URL=https://your-instance.vercel.app
export AGENTBOARD_TOKEN=your-api-key            # if auth is enabled
export AGENTBOARD_AGENT_NAME=MyAgent           # auto-registers as agent member
export AGENTBOARD_PRODUCT=my-product           # default product slug
export AGENTBOARD_BOARD=development            # default board slug (optional, defaults to 'development')
```

## Simple Commands

These use `AGENTBOARD_PRODUCT` and `AGENTBOARD_BOARD` env vars (or `--product`/`--board` flags) to auto-scope to a board.

```bash
# List tasks (excludes done by default)
agentboard list
agentboard list --column todo --priority high
agentboard list --assignee MyAgent --include-done

# Create a task
agentboard new "Build login page"
agentboard new "Fix bug" --priority urgent --assignee MyAgent --due 2025-03-15

# Update status (backlog | todo | doing | in-progress | in-review | done | blocked)
agentboard status <id> doing
agentboard status <id> done

# View task details
agentboard show <id>

# Rename a task
agentboard rename <id> "New title"

# Manage notes (description)
agentboard notes <id>                     # view notes
agentboard notes <id> --set "Full text"   # replace notes
agentboard notes <id> --append "More"     # append to notes

# Toggle attention flag (sets priority to urgent/medium)
agentboard attention <id> on
agentboard attention <id> off

# View commands
agentboard my-tasks                       # tasks assigned to AGENTBOARD_AGENT_NAME
agentboard today                          # tasks due today
agentboard past-due                       # overdue tasks
```

## Management Commands

Full CRUD for all entities. These cover every server API endpoint.

```bash
# Organizations
agentboard org list
agentboard org add "My Org"
agentboard org remove <slug>
agentboard org rename <slug> --name "New Name"
agentboard org reorder --ids 1,2,3

# Products
agentboard product list [--org <slug>]
agentboard product add --org <slug> "My Product" [--emoji "🚀"]
agentboard product remove <slug>
agentboard product rename <slug> --name "New Name" [--emoji "🎯"]
agentboard product move <slug> --org <new-org-slug>
agentboard product reorder --ids 1,2,3

# Boards
agentboard board list [--product <slug>]
agentboard board add "Sprint 1" --product <slug>
agentboard board remove <board-id>
agentboard board rename <board-id> --name "New Name"
agentboard board reorder --ids 1,2,3
agentboard board view [--product <slug> --board <slug>]

# Columns
agentboard column list [--product <slug> --board <slug>]
agentboard column add "QA" [--color "#FF5733"]
agentboard column remove <column-id>
agentboard column rename <column-id> --name "Testing" [--color "#00FF00"]

# Members
agentboard member list
agentboard member add "Agent Smith" --type agent [--color "#FF0000"]
agentboard member remove <member-id>
agentboard member update <member-id> --name "New Name" [--type human]

# Tasks (verbose/power-user syntax)
agentboard task add "Title" --product <slug> --board <slug> [options]
agentboard task list --product <slug> --board <slug> [--assignee X --priority X]
agentboard task show <id>
agentboard task move <id> --column <slug>
agentboard task update <id> [--title X --description X --priority X --due X]
agentboard task done <id>
agentboard task remove <id>
agentboard task link <id> --issue <url>
agentboard task link <id> --pr <url>
agentboard task attach <id> --file <path>
agentboard task attachments <id>
agentboard task reorder --ids 1,2,3

# Attachments
agentboard attachment remove <id>

# Settings & Preferences
agentboard settings                       # view all
agentboard settings --key theme --value dark
agentboard preferences                    # view all
agentboard preferences --key key --value val
```

## Output Flags

- `--json` — JSON output
- `--quiet` — IDs only

## Agent Integration

Set `AGENTBOARD_AGENT_NAME` and the CLI will:
- Send the agent name as `X-Agent-Name` header on card-creation requests
- Auto-register the agent as a member on first card creation
- Default `my-tasks` and `past-due` to the agent's assignments
