"use client";

import { useState } from "react";
import { StoryEntry } from "@/types";
import { Pencil, Trash2, Check, X, Plus, ChevronLeft, BookOpen } from "lucide-react";

interface SidebarProps {
  entries: StoryEntry[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  onRename: (id: string, title: string) => void;
  onDelete: (id: string) => void;
  isOpen: boolean;
  onClose: () => void;
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export default function Sidebar({ entries, selectedId, onSelect, onNew, onRename, onDelete, isOpen, onClose }: SidebarProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");

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

  return (
    <>
      {/* Mobile overlay */}
      {isOpen && (
        <div className="fixed inset-0 bg-black/50 z-20 lg:hidden" onClick={onClose} />
      )}

      <aside
        className={`fixed lg:static inset-y-0 left-0 z-30 w-72 bg-slate-900 flex flex-col h-full transition-transform duration-300 ${
          isOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"
        }`}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-5 border-b border-slate-700">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-violet-600 flex items-center justify-center flex-shrink-0">
              <BookOpen className="w-5 h-5 text-white" />
            </div>
            <span className="text-white font-bold text-lg leading-none">StoryAnalyzer</span>
          </div>
          <button onClick={onClose} className="lg:hidden text-slate-400 hover:text-white p-1 rounded">
            <ChevronLeft className="w-5 h-5" />
          </button>
        </div>

        {/* New Analysis button */}
        <div className="px-4 py-4">
          <button
            onClick={onNew}
            className="w-full flex items-center justify-center gap-2 bg-violet-600 hover:bg-violet-700 text-white font-medium py-2.5 px-4 rounded-lg transition-colors text-sm"
          >
            <Plus className="w-4 h-4" />
            New Analysis
          </button>
        </div>

        {/* History list */}
        <div className="flex-1 overflow-y-auto px-3 pb-4 space-y-1">
          {entries.length === 0 && (
            <p className="text-slate-500 text-xs text-center mt-8 px-4 leading-relaxed">
              No analyses yet. Paste a story and click Analyze!
            </p>
          )}
          {entries.map((entry) => (
            <div
              key={entry.id}
              onClick={() => onSelect(entry.id)}
              className={`group relative flex items-start gap-2 p-3 rounded-lg cursor-pointer transition-colors ${
                selectedId === entry.id
                  ? "bg-violet-600/20 border border-violet-500/30"
                  : "hover:bg-slate-800 border border-transparent"
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
                    className="flex-1 bg-slate-700 text-white text-sm rounded px-2 py-1 outline-none border border-violet-500 min-w-0"
                  />
                  <button onClick={() => commitEdit(entry.id)} className="text-green-400 hover:text-green-300 p-0.5">
                    <Check className="w-3.5 h-3.5" />
                  </button>
                  <button onClick={cancelEdit} className="text-red-400 hover:text-red-300 p-0.5">
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ) : (
                <>
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm font-medium truncate ${selectedId === entry.id ? "text-violet-200" : "text-slate-200"}`}>
                      {entry.title}
                    </p>
                    <p className="text-xs text-slate-500 mt-0.5">{formatDate(entry.createdAt)}</p>
                  </div>
                  <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0 mt-0.5">
                    <button
                      onClick={(e) => startEdit(e, entry)}
                      className="p-1 rounded text-slate-400 hover:text-white hover:bg-slate-700 transition-colors"
                      title="Rename"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); onDelete(entry.id); }}
                      className="p-1 rounded text-slate-400 hover:text-red-400 hover:bg-slate-700 transition-colors"
                      title="Delete"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </>
              )}
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-slate-700">
          <p className="text-xs text-slate-500">Analyses saved locally in your browser</p>
        </div>
      </aside>
    </>
  );
}
