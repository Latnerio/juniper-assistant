import { Fragment, type ReactNode } from "react";

import { cn } from "@/lib/utils";

type MessageProps = {
  role: "user" | "assistant";
  content: string;
};

function renderInline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, index) => {
    const boldMatch = part.match(/^\*\*([^*]+)\*\*$/);
    if (boldMatch) {
      return <strong key={`bold-${index}`}>{boldMatch[1]}</strong>;
    }

    const lines = part.split("\n");
    return (
      <Fragment key={`text-${index}`}>
        {lines.map((line, lineIndex) => (
          <Fragment key={`line-${lineIndex}`}>
            {line}
            {lineIndex < lines.length - 1 ? <br /> : null}
          </Fragment>
        ))}
      </Fragment>
    );
  });
}

function renderMarkdown(content: string): ReactNode {
  const blocks = content.split(/\n{2,}/).filter(Boolean);

  return blocks.map((block, blockIndex) => {
    const lines = block.split("\n").filter(Boolean);
    const isBulletList = lines.every((line) => /^\s*[-*]\s+/.test(line));

    if (isBulletList) {
      return (
        <ul key={`list-${blockIndex}`} className="list-disc space-y-1 pl-5">
          {lines.map((line, itemIndex) => (
            <li key={`item-${itemIndex}`}>{renderInline(line.replace(/^\s*[-*]\s+/, ""))}</li>
          ))}
        </ul>
      );
    }

    return (
      <p key={`paragraph-${blockIndex}`} className="leading-6">
        {renderInline(block)}
      </p>
    );
  });
}

export function Message({ role, content }: MessageProps) {
  const isUser = role === "user";

  return (
    <div className={cn("flex w-full", isUser ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "max-w-[85%] rounded-2xl px-4 py-3 text-sm shadow-sm sm:max-w-[75%]",
          isUser
            ? "bg-primary text-primary-foreground"
            : "border border-border bg-white text-foreground"
        )}
      >
        <div className="space-y-3">{renderMarkdown(content)}</div>
      </div>
    </div>
  );
}
