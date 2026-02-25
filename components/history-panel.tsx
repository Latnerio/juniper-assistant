"use client";

import { Clock, MessageSquare, Plus, Trash2 } from "lucide-react";

import { cn } from "@/lib/utils";

export type HistoryEntry = {
  id: string;
  title: string;
  messages: { role: "user" | "assistant"; content: string }[];
  createdAt: number;
};

type HistoryPanelProps = {
  entries: HistoryEntry[];
  activeId: string | null;
  onSelect: (entry: HistoryEntry) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
};

function formatDate(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const diffDays = Math.floor((now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24));

  if (diffDays === 0) {
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return d.toLocaleDateString([], { weekday: "short" });
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

export function HistoryPanel({ entries, activeId, onSelect, onNew, onDelete }: HistoryPanelProps) {
  return (
    <div className="flex h-full flex-col border-l border-gray-200 bg-gray-50/80">
      <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
        <div className="flex items-center gap-2 text-sm font-medium text-gray-700">
          <Clock className="h-4 w-4" />
          History
        </div>
        <button
          onClick={onNew}
          className="rounded-md p-1.5 text-gray-500 hover:bg-gray-200 hover:text-gray-700"
          title="New conversation"
        >
          <Plus className="h-4 w-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {entries.length === 0 ? (
          <div className="px-4 py-6 text-center text-xs text-gray-400">
            No history yet
          </div>
        ) : (
          <div className="space-y-0.5 p-2">
            {entries.map((entry) => (
              <div
                key={entry.id}
                className={cn(
                  "group flex cursor-pointer items-start gap-2 rounded-lg px-3 py-2.5 text-sm transition-colors",
                  activeId === entry.id
                    ? "bg-white text-gray-900 shadow-sm"
                    : "text-gray-600 hover:bg-white/60 hover:text-gray-800"
                )}
                onClick={() => onSelect(entry)}
              >
                <MessageSquare className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-gray-400" />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium leading-tight">{entry.title}</div>
                  <div className="mt-0.5 text-xs text-gray-400">
                    {formatDate(entry.createdAt)} · {Math.floor(entry.messages.length / 2)} Q&A
                  </div>
                </div>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete(entry.id);
                  }}
                  className="flex-shrink-0 rounded p-1 text-gray-300 opacity-0 transition-opacity hover:text-red-500 group-hover:opacity-100"
                  title="Delete"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
