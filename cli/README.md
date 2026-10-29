# AgentBoard CLI

Lightweight project management for agents and humans.

## Install

```bash
npm install -g agentboard
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
# export AGENTBOARD_BOARD=ops                  # optional: override the product's default board
```

Without `AGENTBOARD_BOARD` or `--board`, the CLI uses the product's default board, set in Settings → Agent default board. A product with a single board needs no default. A product with several boards and no default makes the CLI stop and list them. Against a server too old to have default boards, the CLI falls back to the board slugged `development`.

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
# A board made before Blocked was a default column needs one first:
#   agentboard column add "Blocked" --color "#EF4444"
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
agentboard product add --org <slug> "My Product" [--emoji "🚀"] [--key MP]
agentboard product remove <slug>
agentboard product rename <slug> --name "New Name" [--emoji "🎯"] [--key NN]
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
agentboard task move <id> --column <slug>                       # same board
agentboard task move <id> --to-board <slug> [--column <slug>]    # another board, same product
agentboard task move <id> --to-product <slug> --to-board <slug> [--column <slug>]
agentboard task update <id> [--title X --description X --priority X --due X]
agentboard task done <id>
agentboard task remove <id>
agentboard task link <id> --url <url> [--title <text>]    # any URL: Slack thread, doc, design
agentboard task links <id>
agentboard task unlink <id> --url <url>
agentboard task link <id> --issue <url>
agentboard task link <id> --pr <url>
agentboard task attach <id> --file <path>
agentboard task attachments <id>
agentboard task reorder --ids 1,2,3

# Attachments (ids come from `task attachments <card-id>`)
agentboard attachment get <id>                   # print the content to stdout
agentboard attachment get <id> --out notes.md    # save it; never overwrites without --force
agentboard attachment get <id> --out ./downloads # save under its own filename
agentboard attachment remove <id>

# Sub-tasks (a checklist on a card)
agentboard subtask list <card-id>                # [x]/[ ] per item, then "1/3 done"
agentboard subtask add <card-id> <title>         # words after the id are joined
agentboard subtask done <subtask-id>
agentboard subtask undo <subtask-id>
agentboard subtask rename <subtask-id> <title>
agentboard subtask remove <subtask-id>

# Settings & Preferences
agentboard settings                       # view all
agentboard settings --key theme --value dark
agentboard preferences                    # view all
agentboard preferences --key key --value val
```

Every card has a readable id made of its product's key and a per-product number, like `AB-142`, shown as `key` in `show` and `--json` output. Anywhere a command takes a card `<id>`, the readable id works too, in any case (`show ab-142`), as does the plain number. A product's key is derived from its name when it is created (AgentBoard is `AB`) and can be set with `--key` on `product add` or `product rename`. Old keys keep working after a rename, and a card moved to another product gets a new number there while its old id still finds it.

`task move` keeps the card's current column slug unless `--column` is given, and fails with the destination's available columns if that slug doesn't exist there. The output includes the card's new `product_slug`, `board_slug` and `column_slug`. Labels and assignee carry over unchanged.

A column's slug follows its name. `column rename 12 --name "Can't replicate"` changes the slug from `todo` to `can-t-replicate`, so `status <id> todo` stops finding that column and fails with the board's columns instead of moving a card somewhere that no longer means Todo. A rename whose slug another column on the board already uses is refused. Columns renamed before this rule get their slug updated once when the server starts.

`status` and `--column` take any column slug or name on the board. The shortcuts `doing`, `wip` and `review` map to `in-progress` and `in-review` only when the board has no column whose slug is exactly that word, so a column named "Doing" is reachable as `doing`.

## Flag Handling

Flags a command doesn't support are errors, not ignored — e.g. `task move 14 --product x` fails instead of printing the card as if it had moved. Flags that take a value always consume the next argument, even one starting with `--`, so `--description "--dry-run is broken"` works; `--description=...` also works.

## Exit Codes

Every command exits `0` on success and `1` on any failure, with the reason on stderr: an HTTP error, a server that can't be reached (the message names the URL and cause, such as `ENOTFOUND`), a response that isn't JSON (usually a login page or the wrong `AGENTBOARD_URL`), or a usage error. Scripts can rely on the exit code. `test/cli-exit-codes.test.mjs` checks this for every command.

When an organization, product, board or column isn't found, the error names what you asked for and where it looked, and lists what does exist: `Board 'ship' not found in product 'general'. Available: design (Design), build (Build)`.

## Output Flags

- `--json` — JSON output
- `--quiet` — IDs only

## Agent Integration

Set `AGENTBOARD_AGENT_NAME` and the CLI will:
- Send the agent name as `X-Agent-Name` header on card-creation requests
- Auto-register the agent as a member on first card creation
- Default `my-tasks` and `past-due` to the agent's assignments
