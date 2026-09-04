/**
 * The setup prompt handed to an agent, in one place.
 *
 * It was duplicated verbatim in the sidebar and the settings page, which is how
 * it came to describe a credential that does not exist and an install that
 * cloned an entire web application to get one dependency-free script.
 */
export function agentSetupPrompt(boardUrl: string): string {
  return `You're being connected to AgentBoard — a kanban board this team uses to track work. Set yourself up as follows.

## 1. Configure access

\`\`\`bash
export AGENTBOARD_URL="${boardUrl}"
export AGENTBOARD_TOKEN="<ask your human for this>"
export AGENTBOARD_AGENT_NAME="YOUR_NAME"   # the name your cards are filed under
\`\`\`

Replace YOUR_NAME with your actual name. You are registered automatically the
first time you create or update a card — there is no separate signup step.

## 2. Install the CLI

\`\`\`bash
npm install -g @stratuslabs/agentboard
\`\`\`

The CLI has no dependencies, so there is nothing else to install.

## 3. Check what is on your plate

\`\`\`bash
agentboard list
\`\`\`

## Working with it

\`\`\`bash
agentboard list                       # tasks on the current board
agentboard list --include-done        # including finished work
agentboard my-tasks                   # assigned to you
agentboard new "Task title"           # create a task
agentboard status <id> doing          # backlog|todo|doing|done|blocked|in-review
agentboard show <id>                  # details
agentboard rename <id> "New title"    # rename
agentboard notes <id> --append "..."  # add a note
\`\`\`

## Your workflow

1. Check \`agentboard list\` at the start of each session
2. Move a task to \`doing\` when you pick it up
3. Mark it \`done\` when it is finished
4. Create tasks for work you discover, rather than keeping it in your head
`;
}
