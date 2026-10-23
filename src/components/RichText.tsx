import { Fragment } from "react";
import { parseRichText, type Block, type Inline, type Line } from "@/lib/rich-text";
import { cx } from "./ui";

function Inlines({ nodes }: { nodes: Line }) {
  return (
    <>
      {nodes.map((n: Inline, i: number) => {
        switch (n.type) {
          case "text":
            return <Fragment key={i}>{n.text}</Fragment>;
          case "code":
            return <code key={i} className="rounded bg-surface-3 px-1 py-px font-mono text-[0.88em] text-text-1">{n.text}</code>;
          case "strong":
            return <strong key={i} className="font-semibold text-text-1"><Inlines nodes={n.children} /></strong>;
          case "link":
            return (
              <a key={i} href={n.href} target="_blank" rel="noopener noreferrer"
                className="break-words text-text-1 underline decoration-text-4 underline-offset-2 transition-colors hover:decoration-text-2">
                <Inlines nodes={n.children} />
              </a>
            );
        }
      })}
    </>
  );
}

function Lines({ lines }: { lines: Line[] }) {
  return (
    <>
      {lines.map((line, i) => (
        <Fragment key={i}>
          {i > 0 && <br />}
          <Inlines nodes={line} />
        </Fragment>
      ))}
    </>
  );
}

function BlockView({ block }: { block: Block }) {
  switch (block.type) {
    case "paragraph":
      return <p><Lines lines={block.lines} /></p>;
    case "heading":
      return <p role="heading" aria-level={Math.min(block.level + 2, 6)} className="font-semibold text-text-1"><Inlines nodes={block.content} /></p>;
    case "list": {
      const items = block.items.map((item, i) => <li key={i} className="pl-1"><Lines lines={item} /></li>);
      return block.ordered
        ? <ol start={block.start} className="list-decimal pl-5 marker:text-text-3">{items}</ol>
        : <ul className="list-disc pl-5 marker:text-text-3">{items}</ul>;
    }
  }
}

/**
 * A card description with its light formatting shown: line breaks, lists,
 * headings, links, `code` and **bold**. Built from React elements, never HTML.
 */
export default function RichText({ text, className }: { text: string; className?: string }) {
  const blocks = parseRichText(text);
  return (
    <div className={cx("flex flex-col gap-[0.6em] break-words", className)}>
      {blocks.map((b, i) => <BlockView key={i} block={b} />)}
    </div>
  );
}
