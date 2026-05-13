"use client";

import { Menu, BookOpen } from "lucide-react";

interface HeaderProps {
  onMenuOpen: () => void;
}

export default function Header({ onMenuOpen }: HeaderProps) {
  return (
    <header className="sticky top-0 z-10 flex items-center h-14 px-4 bg-white border-b border-slate-200 lg:hidden">
      <button
        onClick={onMenuOpen}
        className="p-2 rounded-lg text-slate-600 hover:bg-slate-100 transition-colors mr-3"
        aria-label="Open sidebar"
      >
        <Menu className="w-5 h-5" />
      </button>
      <div className="flex items-center gap-2">
        <div className="w-7 h-7 rounded-lg bg-violet-600 flex items-center justify-center">
          <BookOpen className="w-4 h-4 text-white" />
        </div>
        <span className="font-bold text-slate-800 text-base">StoryAnalyzer</span>
      </div>
    </header>
  );
}
