"use client";

import { useEffect, useRef, useState } from "react";
import { useChat } from "@ai-sdk/react";
import { Send } from "lucide-react";

import { Message } from "@/components/message";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";

export function Chat() {
  const [input, setInput] = useState("");
  const scrollerRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const { messages, append, isLoading } = useChat({
    api: "/api/chat",
    streamProtocol: "data"
  });

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, isLoading]);

  const canSend = input.trim().length > 0 && !isLoading;

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    const value = input.trim();
    if (!value) {
      return;
    }

    setInput("");
    await append({ role: "user", content: value });
  };

  return (
    <Card className="flex h-[85vh] min-h-[560px] w-full max-w-4xl flex-col border-red-100 bg-white/95 shadow-lg backdrop-blur">
      <CardHeader className="border-b border-red-100 pb-4">
        <CardTitle className="text-xl text-primary">Juniper Knowledge Assistant</CardTitle>
      </CardHeader>

      <CardContent className="flex flex-1 flex-col gap-4 overflow-hidden p-4 sm:p-6">
        <div ref={scrollerRef} className="flex-1 space-y-4 overflow-y-auto pr-1">
          {messages.length === 0 ? (
            <div className="rounded-lg border border-dashed border-red-200 bg-red-50/40 px-4 py-6 text-sm text-muted-foreground">
              Ask me anything about Juniper Booking Engine... / Chiedimi qualsiasi cosa sul Juniper Booking Engine...
            </div>
          ) : null}

          {messages.map((message) => (
            <Message
              key={message.id}
              role={message.role as "user" | "assistant"}
              content={typeof message.content === "string" ? message.content : ""}
            />
          ))}

          {isLoading ? (
            <div className="flex w-full justify-start">
              <div className="inline-flex items-center gap-2 rounded-2xl border border-border bg-white px-4 py-3 text-sm text-muted-foreground shadow-sm">
                <span className="inline-flex h-2 w-2 animate-pulse rounded-full bg-current [animation-delay:0ms]" />
                <span className="inline-flex h-2 w-2 animate-pulse rounded-full bg-current [animation-delay:120ms]" />
                <span className="inline-flex h-2 w-2 animate-pulse rounded-full bg-current [animation-delay:240ms]" />
                <span>Assistant is typing...</span>
              </div>
            </div>
          ) : null}
          <div ref={endRef} />
        </div>

        <form onSubmit={handleSubmit} className="flex items-end gap-2 border-t border-red-100 pt-4">
          <Textarea
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder="Ask me anything about Juniper Booking Engine... / Chiedimi qualsiasi cosa sul Juniper Booking Engine..."
            className="min-h-[52px] resize-none"
            rows={2}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                if (canSend) {
                  void handleSubmit(event);
                }
              }
            }}
          />
          <Button type="submit" size="icon" disabled={!canSend} aria-label="Send message">
            <Send className="h-4 w-4" />
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
