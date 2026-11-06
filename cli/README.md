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

### Setup from an enrollment token

A server that issues enrollment tokens (AgentBoard Cloud) gives each agent a
setup prompt with a one-time token instead of its key. The token works once
and expires within minutes, so a prompt that ends up in a chat log or a model
transcript doesn't leak a working credential:

```bash
agentboard enroll abe_... --url https://your-instance.example
```

`enroll` trades the token for the agent's own key and saves the key, agent
name, product and board to `~/.config/agentboard/config.json` (or
`$XDG_CONFIG_HOME/agentboard/config.json`, or `AGENTBOARD_CONFIG`), readable
only by you. It never prints the key. Later commands use the saved settings
when the environment variables above are unset, and only for the server they
were saved for: with `AGENTBOARD_URL` pointing elsewhere, the saved key isn't
sent. An existing config is only replaced with `--force`, and that check runs
before the token is spent.

A self-hosted AgentBoard uses one shared password and has no enrollment; set
`AGENTBOARD_TOKEN` there instead.

The server side is `POST /api/agents/enroll` with
`Authorization: Bearer <enrollment token>` and an optional `{ "name": "..." }`
body. It answers `{ "key", "agent_name", "product", "board" }` (the last three
optional), and 401 for a token that is unknown, expired or already used.

Without `AGENTBOARD_BOARD` or `--board`, the CLI uses the product's default board, set in Settings → Agent default board. A product with a single board needs no default. A product with several boards and no default makes the CLI stop and list them. Against a server too old to have default boards, the CLI falls back to the board slugged `development`.

## Help

`agentboard help` lists every command. Each command also has its own help with its usage and every flag it accepts:

```bash
agentboard task move --help      # or: agentboard help task move
agentboard task --help           # the task subcommands, one line each
```

## Simple Commands

These use `AGENTBOARD_PRODUCT` and `AGENTBOARD_BOARD` env vars (or `--product`/`--board` flags) to auto-scope to a board.

```bash
# List tasks (excludes done by default)
agentboard list
agentboard list --column todo --priority high
agentboard list --assignee MyAgent --include-done
agentboard list --fields id,column,title  # pick the table's columns

# Create a task
agentboard new "Build login page"
agentboard new "Fix bug" --priority urgent --assignee MyAgent --due 2025-03-15
# Both print where the card landed first, e.g. "Created AB-12 on my-app/development in Backlog".
# With --json the card includes product_slug, board_slug and column_slug (and their names).

# Update status (backlog | todo | doing | in-progress | in-review | done | blocked)
agentboard status <id> doing
# A board made before Blocked was a default column needs one first:
#   agentboard column add "Blocked" --color "#EF4444"
agentboard status <id> done
# Several cards at once; each moves on its own board
agentboard status 295 296 297 todo

# View task details
agentboard show <id>

# Rename a task
agentboard rename <id> "New title"

# Manage notes (description)
agentboard notes <id>                     # view notes
agentboard notes <id> --set "Full text"   # replace notes (prints old and new length)
agentboard notes <id> --append "More"     # append to notes
agentboard notes <id> --clear             # empty notes on purpose
# --set "" (or only whitespace) is refused, so a script whose generator
# failed can't wipe a card. task update --description "" is refused too.

# Toggle attention flag (sets priority to urgent/medium)
agentboard attention <id> on
agentboard attention <id> off

# View commands
agentboard my-tasks                       # tasks assigned to AGENTBOARD_AGENT_NAME
agentboard my-tasks --fields key,product,column,title

# Search every product for a card before filing a new one
agentboard search "task link"             # every word in the title, description or labels
agentboard search AB-142                  # or a key
agentboard search "task link" --product agentboard --include-done
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
agentboard task move <id> [<id> ...] --column <slug>             # same board
agentboard task move <id> --to-board <slug> [--column <slug>]    # another board, same product
agentboard task move <id> --to-product <slug> --to-board <slug> [--column <slug>]
agentboard task update <id> [--title X --description X --priority X --due X]
agentboard task update <id> --add-label bug,cli      # add labels, keep the rest
agentboard task update <id> --remove-label feedback  # remove one label, keep the rest
agentboard task update <id> --label "a,b"            # replace all labels ("" clears)
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
agentboard attachment get <id> --out notes.md    # save it; never overwrites without --force, never writes through a symlink
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

Every card has a key made of its product's key and a per-product number, like `AB-142`, the name the web app shows. The CLI names cards by key: `show` leads with it, the `list`, `task list` and `my-tasks` tables start with a `key` column, and `--quiet` prints keys. Anywhere a command takes a card `<id>`, the key works, in any case (`show ab-142`), as does the plain number, including `task reorder --ids AB-3,AB-1`. A server from before keys gets ids in their place. A product's key is derived from its name when it is created (AgentBoard is `AB`) and can be set with `--key` on `product add` or `product rename`. Old keys keep working after a rename, and a card moved to another product gets a new number there while its old id still finds it.

`show` and `task show` also print the card's link as `url` (in `--json` too), like `https://agentboard.example.com/c/AB-142`, so you can cite the card itself. It keeps working after the card moves. A server too old to send `url` gets a `/c/<id>` link built from `AGENTBOARD_URL`, since it may not resolve keys there.

`task move` keeps the card's current column slug unless `--column` is given, and fails with the destination's available columns if that slug doesn't exist there. The output includes the card's new `product_slug`, `board_slug` and `column_slug`. Labels and assignee carry over unchanged.

`status` and `task move --column` take several ids. Each card is moved on its own: one that fails (no such card, no such column on its board) is reported as `Error: <id>: ...` and the rest still move. Each moved card prints `Moved <key> to <column>`, or just its key with `--quiet`; `--json` prints one `{ id, ok, column, card | error }` per card. If any failed, the last line counts them and lists their ids, and the exit code is 1. Moving several cards to another board (`--to-board`) isn't supported; with one id the output is the moved card, as before.

A column's slug follows its name. `column rename 12 --name "Can't replicate"` changes the slug from `todo` to `can-t-replicate`, so `status <id> todo` stops finding that column and fails with the board's columns instead of moving a card somewhere that no longer means Todo. A rename whose slug another column on the board already uses is refused. Columns renamed before this rule get their slug updated once when the server starts.

`status` and `--column` take any column slug or name on the board, in any case: a Backlog column renamed "Inbox" keeps the slug `backlog` and answers to `inbox`, `Inbox` and `backlog` alike. An exact match wins, and a word that matches two columns only when case is ignored (say "Review" and "review") is refused rather than guessed, and the error lists each column's slug to use instead. The shortcuts `doing`, `wip` and `review` map to `in-progress` and `in-review` only when the board has no column whose slug is exactly that word, so a column named "Doing" is reachable as `doing`.

## Flag Handling

Flags a command doesn't support are errors, not ignored — e.g. `task move 14 --product x` fails instead of printing the card as if it had moved. Flags that take a value always consume the next argument, even one starting with `--`, so `--description "--dry-run is broken"` works; `--description=...` also works.

## Exit Codes

Every command exits `0` on success and `1` on any failure, with the reason on stderr: an HTTP error, a server that can't be reached (the message names the URL and cause, such as `ENOTFOUND`), a response that isn't JSON (usually a login page or the wrong `AGENTBOARD_URL`), or a usage error. Scripts can rely on the exit code. `test/cli-exit-codes.test.mjs` checks this for every command.

When an organization, product, board or column isn't found, the error names what you asked for and where it looked, and lists what does exist: `Board 'ship' not found in product 'general'. Available: design (Design), build (Build)`.

## Output Flags

- `--json` — JSON output
- `--quiet` — Card keys only for commands that print cards, ids for the rest. `notes` and `attachment get` differ; `agentboard <command> --help` says how
- `--fields key,product,column,title` — on `list`, `task list`, `my-tasks` and `search`, the fields to print, in that order. Any card field works (`id`, `labels`, `due_date`, ...), plus `key` (the id on a server without keys), `product` and `board` (slug, or name from an older server), `column` (name) and `assignee` (member name, or the legacy text assignee). With `--json`, each card keeps only these fields. An unknown field is an error that lists the available ones.

`search <text>` looks in every product, whatever `AGENTBOARD_PRODUCT` says, unless you pass `--product`. A card matches when each word is in its title, description or labels, or the text is its key (old keys too). Cards in Done are left out unless `--include-done`. It prints `key title product board column`, best matches first: cards a key names, then title matches, then the rest. A search returns at most 50 cards; when it hits that, a note on stderr says more may match.

`list` prints a short table, `id title column assignee priority`, under a `Board: <product>/<board>` line naming the board it read, so a product set by `AGENTBOARD_PRODUCT` is never a surprise. `my-tasks` prints `id title product board column priority`. `--json` still returns every field, and each card from `list` and `task list` carries `column_name`, `column_slug`, `board_slug`, `board_name`, `product_slug` and `product_name`, filled in by the CLI when the server is too old to send them.

## Agent Integration

Set `AGENTBOARD_AGENT_NAME` and the CLI will:
- Send the agent name as `X-Agent-Name` header on card-creation requests
- Auto-register the agent as a member on first card creation
- Default `my-tasks` and `past-due` to the agent's assignments
