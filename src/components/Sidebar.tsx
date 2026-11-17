"use client";

import { useState } from "react";
import { StoryEntry } from "@/types";
import { Pencil, Trash2, Check, X, Plus, ChevronLeft, BookOpen, Sun, Moon, LogOut, Search, Sparkles, Loader2, Bug } from "lucide-react";
import { useSession, signOut } from "next-auth/react";
import { useTheme } from "@/hooks/useTheme";

interface SidebarProps {
  entries: StoryEntry[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  onReportBug: () => void;
  bugCount?: number;
  onShowBugs?: () => void;
  onRename: (id: string, title: string) => void;
  onDelete: (id: string) => void;
  isOpen: boolean;
  onClose: () => void;
}

function relTime(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.round(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function groupOf(iso: string) {
  const d = new Date(iso);
  const start = new Date(); start.setHours(0, 0, 0, 0);
  const day = 86400000;
  if (d.getTime() >= start.getTime()) return "Today";
  if (d.getTime() >= start.getTime() - day) return "Yesterday";
  if (d.getTime() >= start.getTime() - 6 * day) return "This week";
  return "Earlier";
}
const GROUPS = ["Today", "Yesterday", "This week", "Earlier"];

export default function Sidebar({ entries, selectedId, onSelect, onNew, onReportBug, bugCount = 0, onShowBugs, onRename, onDelete, isOpen, onClose }: SidebarProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [query, setQuery] = useState("");
  const { theme, toggleTheme } = useTheme();
  const { data: session } = useSession();

  const startEdit = (e: React.MouseEvent, entry: StoryEntry) => {
    e.stopPropagation();
    setEditingId(entry.id);
    setEditValue(entry.title);
  };

  const commitEdit = (id: string) => {
    if (editValue.trim()) onRename(id, editValue.trim());
    setEditingId(null);
  };

  const cancelEdit = () => setEditingId(null);

  const q = query.trim().toLowerCase();
  const filtered = q
    ? entries.filter((e) => `${e.jiraKey ?? ""} ${e.title}`.toLowerCase().includes(q))
    : entries;
  const grouped = GROUPS
    .map((g) => ({ g, list: filtered.filter((e) => groupOf(e.updatedAt || e.createdAt) === g) }))
    .filter((x) => x.list.length > 0);

  const user = session?.user;
  const initials = (user?.name ?? user?.email ?? "?").split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();

  return (
    <>
      {/* Mobile overlay */}
      {isOpen && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-20 lg:hidden" onClick={onClose} />
      )}

      <aside
        className={`fixed lg:static inset-y-0 left-0 z-30 w-72 flex flex-col h-full transition-transform duration-300 bg-gradient-to-b from-slate-900 via-slate-900 to-slate-950 border-r border-white/5 ${
          isOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"
        }`}
      >
        {/* Header */}
        <div className="flex items-center gap-3 px-4 pt-5 pb-4">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-violet-500 to-fuchsia-600 flex items-center justify-center flex-shrink-0 shadow-lg shadow-violet-900/40">
            <BookOpen className="w-[18px] h-[18px] text-white" />
          </div>
          <div className="flex-1 min-w-0 leading-tight">
            <div className="text-white font-semibold tracking-tight">StoryAnalyzer</div>
            <div className="text-[11px] text-slate-400">QA analysis for user stories</div>
          </div>
          <button onClick={onClose} className="lg:hidden text-slate-400 hover:text-white p-1.5 rounded-lg hover:bg-white/5">
            <ChevronLeft className="w-5 h-5" />
          </button>
        </div>

        {/* New analysis + search */}
        <div className="px-3 space-y-2.5">
          <button
            onClick={onNew}
            className="w-full flex items-center gap-2.5 bg-violet-600 hover:bg-violet-500 text-white font-medium py-2.5 px-3.5 rounded-xl transition-colors text-sm shadow-lg shadow-violet-950/40"
          >
            <Plus className="w-4 h-4" />
            New analysis
          </button>
          <button
            onClick={onReportBug}
            title="Report a bug in any Jira project, not tied to a story"
            className="w-full flex items-center gap-2.5 text-slate-300 hover:text-white hover:bg-white/[0.06] font-medium py-2 px-3.5 rounded-xl transition-colors text-sm"
          >
            <Bug className="w-4 h-4 text-indigo-300" />
            Report a bug
          </button>
          {onShowBugs && bugCount > 0 && (
            <button
              onClick={onShowBugs}
              title="See and edit bugs you reported from here"
              className="w-full flex items-center gap-2.5 text-slate-400 hover:text-white hover:bg-white/[0.06] py-1.5 px-3.5 rounded-xl transition-colors text-xs"
            >
              <span className="w-4 text-center text-indigo-300 font-semibold">{bugCount}</span>
              Bugs I reported
            </button>
          )}
          {entries.length > 0 && (
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search stories"
                className="w-full bg-white/5 border border-white/5 focus:border-violet-500/50 text-slate-200 placeholder:text-slate-500 text-xs rounded-lg pl-8 pr-7 py-2 outline-none transition-colors"
              />
              {query && (
                <button onClick={() => setQuery("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300">
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          )}
        </div>

        {/* History list */}
        <div className="flex-1 overflow-y-auto nice-scroll px-3 pt-4 pb-4 space-y-4">
          {entries.length === 0 && (
            <div className="mt-6 mx-1 rounded-xl border border-dashed border-white/10 p-5 text-center">
              <Sparkles className="w-5 h-5 text-violet-400 mx-auto mb-2" />
              <p className="text-slate-300 text-xs font-medium">No analyses yet</p>
              <p className="text-slate-500 text-[11px] mt-1 leading-relaxed">Enter a Jira ticket or paste a story to get started.</p>
            </div>
          )}
          {entries.length > 0 && grouped.length === 0 && (
            <p className="text-slate-500 text-xs text-center mt-6">No stories match “{query}”.</p>
          )}
          {grouped.map(({ g, list }) => (
            <div key={g}>
              <div className="px-2 mb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500">{g}</div>
              <div className="space-y-0.5">
                {list.map((entry) => {
                  const active = selectedId === entry.id;
                  return (
                    <div
                      key={entry.id}
                      onClick={() => onSelect(entry.id)}
                      className={`group relative flex items-start gap-2 pl-3.5 pr-2 py-2.5 rounded-xl cursor-pointer transition-all border ${
                        active ? "bg-violet-500/10 border-violet-400/20" : "border-transparent hover:bg-white/[0.04]"
                      }`}
                    >
                      
                      {editingId === entry.id ? (
                        <div className="flex-1 flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                          <input
                            autoFocus
                            value={editValue}
                            onChange={(e) => setEditValue(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") commitEdit(entry.id);
                              if (e.key === "Escape") cancelEdit();
                            }}
                            className="flex-1 bg-slate-800 text-white text-sm rounded-lg px-2 py-1 outline-none border border-violet-500 min-w-0"
                          />
                          <button onClick={() => commitEdit(entry.id)} className="text-emerald-400 hover:text-emerald-300 p-0.5">
                            <Check className="w-3.5 h-3.5" />
                          </button>
                          <button onClick={cancelEdit} className="text-rose-400 hover:text-rose-300 p-0.5">
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ) : (
                        <>
                          <div className="flex-1 min-w-0">
                            {entry.jiraKey && (
                              <span className={`inline-block font-mono text-[10px] font-semibold px-1.5 py-0.5 rounded-md mb-1 ${active ? "bg-violet-400/20 text-violet-200" : "bg-white/[0.06] text-slate-400"}`}>{entry.jiraKey}</span>
                            )}
                            <p
                              className={`text-[13px] leading-snug line-clamp-2 ${active ? "text-white font-medium" : "text-slate-300 group-hover:text-slate-100"}`}
                              title={entry.jiraKey ? `${entry.jiraKey}: ${entry.title}` : entry.title}
                            >
                              {entry.title}
                            </p>
                            <div className="flex items-center gap-1.5 mt-1 text-[11px] text-slate-500">
                              {entry.isPending ? (
                                <span className="flex items-center gap-1 text-violet-300"><Loader2 className="w-3 h-3 animate-spin" />Analyzing…</span>
                              ) : entry.analysis ? (
                                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400/80" title="Analyzed" />
                              ) : (
                                <span className="w-1.5 h-1.5 rounded-full bg-slate-600" title="Not analyzed" />
                              )}
                              {!entry.isPending && <span>{relTime(entry.updatedAt || entry.createdAt)}</span>}
                            </div>
                          </div>
                          <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
                            <button
                              onClick={(e) => startEdit(e, entry)}
                              className="p-1 rounded-md text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
                              title="Rename"
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={(e) => { e.stopPropagation(); onDelete(entry.id); }}
                              className="p-1 rounded-md text-slate-400 hover:text-rose-400 hover:bg-white/10 transition-colors"
                              title="Delete"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="p-3 border-t border-white/5">
          <div className="flex items-center gap-2.5 p-2 rounded-xl bg-white/[0.03]">
            {user?.image ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={user.image} alt="" className="w-8 h-8 rounded-full ring-2 ring-white/10" />
            ) : (
              <div className="w-8 h-8 rounded-full bg-slate-700 text-slate-200 text-xs font-semibold flex items-center justify-center">{initials}</div>
            )}
            <div className="flex-1 min-w-0 leading-tight">
              <div className="text-xs font-medium text-slate-200 truncate" title="Copilot requests use this GitHub account">
                {user?.name ?? user?.email ?? "Not signed in"}
              </div>
              <div className="text-[10px] text-slate-500 truncate">Saved locally in this browser</div>
            </div>
            <button
              onClick={toggleTheme}
              className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
              aria-label="Toggle dark mode"
              title={theme === "dark" ? "Light mode" : "Dark mode"}
            >
              {theme === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>
            {user && (
              <button
                onClick={() => signOut({ redirectTo: "/login" })}
                className="p-1.5 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-white/10 transition-colors"
                title="Sign out"
              >
                <LogOut className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
      </aside>
    </>
  );
}
