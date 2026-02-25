"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useChat } from "@ai-sdk/react";
import { LogOut, Send, Shield } from "lucide-react";
import { useRouter } from "next/navigation";

import { Message } from "@/components/message";
import { HistoryPanel, type HistoryEntry } from "@/components/history-panel";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";

export function Chat() {
  const [input, setInput] = useState("");
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [activeConvoId, setActiveConvoId] = useState<string | null>(null);
  const [viewingEntry, setViewingEntry] = useState<HistoryEntry | null>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  const { messages, append, isLoading, setMessages } = useChat({
    api: "/api/chat",
    streamProtocol: "text"
  });

  // Load user info
  useEffect(() => {
    const supabase = getSupabaseBrowserClient();
    supabase.auth.getUser().then(({ data: { user } }: { data: { user: any } }) => {
      if (user) {
        setUserEmail(user.email ?? null);
        supabase
          .from("user_profiles")
          .select("is_admin")
          .eq("id", user.id)
          .single()
          .then(({ data }: { data: any }) => {
            if (data?.is_admin) setIsAdmin(true);
          });
      }
    });
  }, []);

  // Load history from Supabase
  useEffect(() => {
    fetch("/api/conversations")
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) {
          setHistory(
            data.map((c: any) => ({
              id: c.id,
              title: c.title,
              messages: c.messages,
              createdAt: new Date(c.created_at).getTime(),
            }))
          );
        }
      })
      .catch(() => {});
  }, []);

  // Auto-scroll
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, isLoading]);

  // Save to Supabase when assistant finishes responding
  useEffect(() => {
    if (isLoading || messages.length < 2) return;
    const lastMsg = messages[messages.length - 1];
    if (lastMsg.role !== "assistant") return;

    const firstUserMsg = messages.find((m) => m.role === "user");
    if (!firstUserMsg) return;

    const title = firstUserMsg.content.slice(0, 80) + (firstUserMsg.content.length > 80 ? "..." : "");
    const serialized = messages.map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));

    const body = { id: activeConvoId, title, messages: serialized };

    fetch("/api/conversations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
      .then((r) => r.json())
      .then((data) => {
        if (data.id && !activeConvoId) {
          setActiveConvoId(data.id);
        }
        // Refresh history
        fetch("/api/conversations")
          .then((r) => r.json())
          .then((convos) => {
            if (Array.isArray(convos)) {
              setHistory(
                convos.map((c: any) => ({
                  id: c.id,
                  title: c.title,
                  messages: c.messages,
                  createdAt: new Date(c.created_at).getTime(),
                }))
              );
            }
          });
      })
      .catch(() => {});
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
    setTimeout(() => {
      scrollerRef.current?.scrollTo({ top: 0, behavior: "smooth" });
    }, 50);
  }, [setMessages]);

  const handleDelete = useCallback((id: string) => {
    fetch("/api/conversations", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    }).catch(() => {});

    setHistory((prev) => prev.filter((e) => e.id !== id));
    if (activeConvoId === id) {
      setMessages([]);
      setActiveConvoId(null);
    }
  }, [activeConvoId, setMessages]);

  const handleLogout = async () => {
    const supabase = getSupabaseBrowserClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  };

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
        <div className="flex items-center justify-between border-b border-red-100 px-6 py-4">
          <h1 className="text-xl font-semibold text-primary">Juniper Knowledge Assistant</h1>
          <div className="flex items-center gap-3">
            {isAdmin && (
              <button
                onClick={() => router.push("/admin")}
                className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-gray-500 hover:bg-gray-100 hover:text-gray-700"
                title="Admin Panel"
              >
                <Shield className="h-3.5 w-3.5" />
                Admin
              </button>
            )}
            {userEmail && (
              <span className="text-xs text-gray-500">{userEmail}</span>
            )}
            <button
              onClick={handleLogout}
              className="rounded-md p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
              title="Logout"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
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
