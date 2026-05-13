"use client";

import { useState, useEffect, useCallback } from "react";
import { StoryEntry, Analysis } from "@/types";

const STORAGE_KEY = "story-analyzer-history";

export function useHistory() {
  const [entries, setEntries] = useState<StoryEntry[]>([]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) setEntries(JSON.parse(raw));
    } catch {
      setEntries([]);
    }
  }, []);

  const persist = useCallback((updated: StoryEntry[]) => {
    setEntries(updated);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  }, []);

  const addEntry = useCallback(
    (storyText: string, analysis: Analysis): StoryEntry => {
      const now = new Date().toISOString();
      const title =
        storyText.trim().split(/\s+/).slice(0, 6).join(" ") +
        (storyText.trim().split(/\s+/).length > 6 ? "…" : "");
      const entry: StoryEntry = {
        id: crypto.randomUUID(),
        title,
        storyText,
        analysis,
        createdAt: now,
        updatedAt: now,
      };
      persist([entry, ...entries]);
      return entry;
    },
    [entries, persist]
  );

  const removeEntry = useCallback(
    (id: string) => {
      persist(entries.filter((e) => e.id !== id));
    },
    [entries, persist]
  );

  const renameEntry = useCallback(
    (id: string, title: string) => {
      persist(
        entries.map((e) =>
          e.id === id ? { ...e, title, updatedAt: new Date().toISOString() } : e
        )
      );
    },
    [entries, persist]
  );

  const getEntry = useCallback(
    (id: string) => entries.find((e) => e.id === id),
    [entries]
  );

  return { entries, addEntry, removeEntry, renameEntry, getEntry };
}
