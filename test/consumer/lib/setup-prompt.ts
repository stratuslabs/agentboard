/**
 * Stands in for a hosted edition's own agent setup prompt: per-agent API keys
 * instead of a shared token, say. The core shows it wherever it would show its
 * own, in the sidebar's get-started card and the settings connect section.
 */
export function consumerSetupPrompt(boardUrl: string): string {
  return `# Consumer setup prompt

Connect to the consumer edition at ${boardUrl} with the API key your human made for you.
`;
}
