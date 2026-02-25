"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useChat } from "@ai-sdk/react";
import { Send } from "lucide-react";

import { Message } from "@/components/message";
import { HistoryPanel, type HistoryEntry } from "@/components/history-panel";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

const STORAGE_KEY = "juniper-assistant-history";

function loadHistory(): HistoryEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveHistory(entries: HistoryEntry[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries.slice(0, 100)));
  } catch { /* quota exceeded */ }
}

export function Chat() {
  const [input, setInput] = useState("");
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [activeConvoId, setActiveConvoId] = useState<string | null>(null);
  const [viewingEntry, setViewingEntry] = useState<HistoryEntry | null>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);

  const { messages, append, isLoading, setMessages } = useChat({
    api: "/api/chat",
    streamProtocol: "text"
  });

  // Load history on mount
  useEffect(() => {
    setHistory(loadHistory());
  }, []);

  // Auto-scroll
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, isLoading]);

  // Save to history when assistant finishes responding
  useEffect(() => {
    if (isLoading || messages.length < 2) return;
    const lastMsg = messages[messages.length - 1];
    if (lastMsg.role !== "assistant") return;

    const firstUserMsg = messages.find((m) => m.role === "user");
    if (!firstUserMsg) return;

    const title = firstUserMsg.content.slice(0, 80) + (firstUserMsg.content.length > 80 ? "..." : "");
    const serialized = messages.map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));

    setHistory((prev) => {
      const existing = prev.findIndex((e) => e.id === activeConvoId);
      let updated: HistoryEntry[];
      if (existing >= 0) {
        updated = [...prev];
        updated[existing] = { ...updated[existing], messages: serialized, title };
      } else {
        const id = crypto.randomUUID();
        setActiveConvoId(id);
        updated = [{ id, title, messages: serialized, createdAt: Date.now() }, ...prev];
      }
      saveHistory(updated);
      return updated;
    });
  }, [isLoading, messages, activeConvoId]);

  const handleNew = useCallback(() => {
    setMessages([]);
    setActiveConvoId(null);
    setViewingEntry(null);
  }, [setMessages]);

  const handleSelect = useCallback((entry: HistoryEntry) => {
    setViewingEntry(null);
    setActiveConvoId(entry.id);
    const restored = entry.messages.map((m, i) => ({
      id: `${entry.id}-${i}`,
      role: m.role as "user" | "assistant",
      content: m.content
    }));
    setMessages(restored);
    // Scroll to top after restoring
    setTimeout(() => {
      scrollerRef.current?.scrollTo({ top: 0, behavior: "smooth" });
    }, 50);
  }, [setMessages]);

  const handleDelete = useCallback((id: string) => {
    setHistory((prev) => {
      const updated = prev.filter((e) => e.id !== id);
      saveHistory(updated);
      return updated;
    });
    if (activeConvoId === id) {
      setMessages([]);
      setActiveConvoId(null);
    }
  }, [activeConvoId, setMessages]);

  const canSend = input.trim().length > 0 && !isLoading;

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    const value = input.trim();
    if (!value) return;
    setViewingEntry(null);
    setInput("");
    await append({ role: "user", content: value });
  };

  return (
    <div className="flex h-[92vh] min-h-[560px] w-full overflow-hidden rounded-2xl border border-red-100 bg-white/95 shadow-lg backdrop-blur">
      {/* Main chat area */}
      <div className="flex flex-1 flex-col">
        <div className="border-b border-red-100 px-6 py-4">
          <h1 className="text-xl font-semibold text-primary">Juniper Knowledge Assistant</h1>
        </div>

        <div className="flex flex-1 flex-col gap-4 overflow-hidden p-4 sm:p-6">
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
                  <span>Thinking...</span>
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
        </div>
      </div>

      {/* History panel */}
      <div className="hidden w-72 flex-shrink-0 lg:block">
        <HistoryPanel
          entries={history}
          activeId={activeConvoId}
          onSelect={handleSelect}
          onNew={handleNew}
          onDelete={handleDelete}
        />
      </div>
    </div>
  );
}
