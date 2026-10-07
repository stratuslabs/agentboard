"use client";

import { useState, useSyncExternalStore } from "react";
import { Check, Copy, FileText } from "lucide-react";
import { Avatar, Button } from "../ui";
import { agentSetupPrompt } from "@/lib/agent-prompt";
import { useBoardMembers } from "./BoardMembers";

const STEPS = ["Register itself as a team member", "Set up the CLI", "Check for assigned tasks", "Start working"];

/** Colours the prompt like the design: headings silver, fences dim, the rest plain. */
function PromptLine({ line }: { line: string }) {
  const tone = line.startsWith("#") ? "text-silver" : line.startsWith("```") ? "text-text-4" : "text-text-1";
  return <div className={tone}>{line || " "}</div>;
}

const PLACEHOLDER_URL = "https://your-agentboard-url.com";
const noSubscription = () => () => {};

export default function ConnectAgent() {
  const { members } = useBoardMembers();
  const [copied, setCopied] = useState(false);
  // The server renders the placeholder and the browser swaps in its own
  // origin after hydrating, so the two renders agree.
  const boardUrl = useSyncExternalStore(noSubscription, () => window.location.origin, () => PLACEHOLDER_URL);
  const prompt = agentSetupPrompt(boardUrl);
  const agents = members.filter((m) => m.type === "agent");

  function handleCopy() {
    navigator.clipboard.writeText(prompt);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <>
      <div className="flex flex-col gap-3">
        <p className="text-[12.5px] text-text-2">How it works — copy the prompt below and paste it to your agent. The agent will:</p>
        <ol className="grid grid-cols-4 gap-2 max-sm:grid-cols-2">
          {STEPS.map((step, i) => (
            <li key={step} className="flex flex-col gap-2.5 rounded-lg border border-border bg-surface-1 p-3">
              <span className="font-mono text-[11px] text-text-3">{String(i + 1).padStart(2, "0")}</span>
              <span className="text-[12.5px] leading-[1.4] text-text-1">{step}</span>
            </li>
          ))}
        </ol>
      </div>

      <div className="overflow-hidden rounded-[10px] border border-border-strong bg-[#080707]">
        <div className="flex h-11 items-center gap-2 border-b border-border bg-surface-1 pr-2 pl-3.5">
          <FileText className="h-3.5 w-3.5 text-text-3" />
          <span className="flex-1 font-mono text-[11.5px] text-text-2">agent-setup-prompt.md</span>
          <Button size="sm" className="h-7 text-xs" onClick={handleCopy}>
            {copied ? <><Check className="h-3.5 w-3.5 text-success" />Copied</> : <><Copy className="h-3.5 w-3.5" />Copy prompt</>}
          </Button>
        </div>
        <pre className="max-h-[300px] overflow-auto px-[18px] py-4 font-mono text-xs leading-[1.6] whitespace-pre-wrap">
          {prompt.split("\n").map((line, i) => <PromptLine key={i} line={line} />)}
        </pre>
      </div>

      {agents.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[12.5px] text-text-3">Connected agents</span>
          {agents.map((a) => (
            <span key={a.id} className="flex h-[26px] items-center gap-1.5 rounded-full border border-border-strong bg-surface-2 pr-2.5 pl-1 text-[12.5px] text-text-1">
              <Avatar name={a.name} color={a.color} size={18} />
              {a.name}
            </span>
          ))}
        </div>
      )}
    </>
  );
}
