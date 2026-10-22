"use client";

import { useState, useEffect, useCallback } from "react";
import { StoryEntry, Analysis, ChecklistItem } from "@/types";

const STORAGE_KEY = "story-analyzer-history";

function generateId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
}

/** Derive a concise sidebar title from raw story text (client-side fallback). */
function deriveTitle(storyText: string): string {
  const text = storyText.trim();
  // "As a(n) [role], I want to [action]"
  const asAMatch = text.match(/as\s+an?\s+[\w\s]{1,30},?\s+i\s+(?:want|need|can)\s+to\s+([^,.;([\n]+)/i);
  if (asAMatch) {
    const action = asAMatch[1].trim();
    const jiraMatch = text.match(/\b([A-Z]{2,10}-\d+)\b/);
    const words = action.split(/\s+/).slice(0, 6).join(" ");
    return (jiraMatch ? `${jiraMatch[1]}: ` : "") + words + (action.split(/\s+/).length > 6 ? "…" : "");
  }
  const jiraMatch = text.match(/\b([A-Z]{2,10}-\d+)\b/);
  // First line that looks like a title (short, no trailing punctuation)
  const firstLine = text.split(/\n/)[0].trim();
  if (firstLine.length > 0 && firstLine.length <= 80 && !/[.!?]$/.test(firstLine)) {
    const title = firstLine.slice(0, 60) + (firstLine.length > 60 ? "…" : "");
    return jiraMatch && !firstLine.includes(jiraMatch[1]) ? `${jiraMatch[1]}: ${title}` : title;
  }
  // First 7 words
  const allWords = text.split(/\s+/);
  const title = allWords.slice(0, 7).join(" ") + (allWords.length > 7 ? "…" : "");
  return jiraMatch && !title.includes(jiraMatch[1]) ? `${jiraMatch[1]}: ${allWords.slice(0, 5).join(" ")}…` : title;
}

/** Pick the best available title: AI-generated > derived from text. */
function resolveTitle(storyText: string, analysis?: Analysis): string {
  const ai = analysis?.meta?.generatedTitle;
  if (ai && ai.length > 0) return ai;
  return deriveTitle(storyText);
}

/** Normalize a raw localStorage entry so missing optional fields don't crash the app. */
function normalizeEntry(raw: unknown): StoryEntry | null {
  if (!raw || typeof raw !== "object") return null;
  const e = raw as Record<string, unknown>;
  if (typeof e.id !== "string" || typeof e.storyText !== "string") return null;
  return {
    id: e.id,
    title: typeof e.title === "string" && e.title.length > 0 ? e.title : deriveTitle(e.storyText as string),
    storyText: e.storyText as string,
    ...(typeof e.jiraKey === "string" ? { jiraKey: e.jiraKey } : {}),
    ...(typeof e.jiraUrl === "string" ? { jiraUrl: e.jiraUrl } : {}),
    ...(e.jiraPostedSections && typeof e.jiraPostedSections === "object" ? { jiraPostedSections: e.jiraPostedSections as Record<string, string> } : {}),
    analysis: e.analysis as Analysis | undefined,
    ...(Array.isArray(e.checklist) ? { checklist: e.checklist as ChecklistItem[] } : {}),
    ...(Array.isArray(e.checklistPostedCategories) ? { checklistPostedCategories: e.checklistPostedCategories as string[] } : {}),
    isPending: typeof e.isPending === "boolean" ? e.isPending : false,
    createdAt: typeof e.createdAt === "string" ? e.createdAt : new Date().toISOString(),
    updatedAt: typeof e.updatedAt === "string" ? e.updatedAt : new Date().toISOString(),
  };
}

export function useHistory() {
  const [entries, setEntries] = useState<StoryEntry[]>([]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed: unknown[] = JSON.parse(raw);
        const normalized = parsed
          .map(normalizeEntry)
          .filter((e): e is StoryEntry => e !== null && !e.isPending);
        setEntries(normalized);
      }
    } catch {
      setEntries([]);
    }
  }, []);

  const persist = useCallback((transform: (current: StoryEntry[]) => StoryEntry[]) => {
    setEntries((prev) => {
      const next = transform(prev);
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch { /* ignore quota errors */ }
      return next;
    });
  }, []);

  const addEntry = useCallback(
    (storyText: string, analysis: Analysis): StoryEntry => {
      const now = new Date().toISOString();
      const entry: StoryEntry = {
        id: generateId(),
        title: resolveTitle(storyText, analysis),
        storyText,
        analysis,
        createdAt: now,
        updatedAt: now,
      };
      persist((prev) => [entry, ...prev]);
      return entry;
    },
    [persist]
  );

  const removeEntry = useCallback(
    (id: string) => { persist((prev) => prev.filter((e) => e.id !== id)); },
    [persist]
  );

  const renameEntry = useCallback(
    (id: string, title: string) => {
      persist((prev) =>
        prev.map((e) => e.id === id ? { ...e, title, updatedAt: new Date().toISOString() } : e)
      );
    },
    [persist]
  );

  const getEntry = useCallback(
    (id: string) => entries.find((e) => e.id === id),
    [entries]
  );

  const addPendingEntry = useCallback(
    (storyText: string, jiraKey?: string, jiraUrl?: string): StoryEntry => {
      const now = new Date().toISOString();
      const entry: StoryEntry = {
        id: generateId(),
        title: deriveTitle(storyText),
        storyText,
        ...(jiraKey ? { jiraKey } : {}),
        ...(jiraUrl ? { jiraUrl } : {}),
        isPending: true,
        createdAt: now,
        updatedAt: now,
      };
      persist((prev) => [entry, ...prev]);
      return entry;
    },
    [persist]
  );

  const finalizeEntry = useCallback(
    (id: string, analysis: Analysis): void => {
      persist((prev) => {
        const entry = prev.find((e) => e.id === id);
        if (!entry) return prev;
        const updated = { ...entry, title: resolveTitle(entry.storyText, analysis), analysis, isPending: false, updatedAt: new Date().toISOString() };
        return [updated, ...prev.filter((e) => e.id !== id)];
      });
    },
    [persist]
  );

  const updateEntry = useCallback(
    (id: string, storyText: string, analysis: Analysis, jiraKey?: string, jiraUrl?: string): void => {
      persist((prev) => {
        const entry = prev.find((e) => e.id === id);
        if (!entry) return prev;
        const updated: StoryEntry = {
          ...entry,
          title: resolveTitle(storyText, analysis),
          storyText,
          analysis,
          isPending: false,
          updatedAt: new Date().toISOString(),
          jiraPostedSections: undefined,
          ...(jiraKey !== undefined ? { jiraKey } : {}),
          ...(jiraUrl !== undefined ? { jiraUrl } : {}),
        };
        return [updated, ...prev.filter((e) => e.id !== id)];
      });
    },
    [persist]
  );

  const markJiraPosted = useCallback(
    (id: string, sectionTitle: string, fingerprint: string): void => {
      persist((prev) =>
        prev.map((e) =>
          e.id === id
            ? { ...e, jiraPostedSections: { ...e.jiraPostedSections, [sectionTitle]: fingerprint } }
            : e
        )
      );
    },
    [persist]
  );

  /** Merge a partial analysis patch into an existing entry without resetting other fields. */
  const patchAnalysis = useCallback(
    (id: string, patch: Partial<Analysis>): void => {
      persist((prev) =>
        prev.map((e) =>
          e.id === id && e.analysis
            ? { ...e, analysis: { ...e.analysis, ...patch }, updatedAt: new Date().toISOString() }
            : e
        )
      );
    },
    [persist]
  );

  const patchChecklist = useCallback(
    (id: string, checklist: ChecklistItem[]): void => {
      persist((prev) =>
        prev.map((e) =>
          e.id === id ? { ...e, checklist, updatedAt: new Date().toISOString() } : e
        )
      );
    },
    [persist]
  );

  const markChecklistCategoryPosted = useCallback(
    (id: string, category: string): void => {
      persist((prev) =>
        prev.map((e) =>
          e.id === id
            ? { ...e, checklistPostedCategories: [...new Set([...(e.checklistPostedCategories ?? []), category])] }
            : e
        )
      );
    },
    [persist]
  );

  return { entries, addEntry, addPendingEntry, finalizeEntry, updateEntry, patchAnalysis, patchChecklist, markJiraPosted, markChecklistCategoryPosted, removeEntry, renameEntry, getEntry };
}
