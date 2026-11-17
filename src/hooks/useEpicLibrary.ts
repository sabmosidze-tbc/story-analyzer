"use client";

import { useState, useEffect, useCallback } from "react";
import { EpicContext } from "@/types";

const STORAGE_KEY = "story-analyzer-epics";

function loadFromStorage(): EpicContext[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as EpicContext[];
  } catch {
    return [];
  }
}

const SYNC_EVENT = "epic-library-updated";

function saveToStorage(epics: EpicContext[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(epics));
    // Notify other hook instances after the current React batch completes
    setTimeout(() => window.dispatchEvent(new CustomEvent(SYNC_EVENT)), 0);
  } catch { /* quota exceeded — ignore */ }
}

export function useEpicLibrary() {
  const [epics, setEpics] = useState<EpicContext[]>([]);

  useEffect(() => {
    setEpics(loadFromStorage());

    const handleSync = () => setEpics(loadFromStorage());
    window.addEventListener(SYNC_EVENT, handleSync);
    return () => window.removeEventListener(SYNC_EVENT, handleSync);
  }, []);

  const saveEpic = useCallback((ctx: EpicContext) => {
    setEpics((prev) => {
      const filtered = prev.filter((e) => e.epicKey !== ctx.epicKey);
      const next = [ctx, ...filtered];
      saveToStorage(next);
      return next;
    });
  }, []);

  const deleteEpic = useCallback((epicKey: string) => {
    setEpics((prev) => {
      const next = prev.filter((e) => e.epicKey !== epicKey);
      saveToStorage(next);
      return next;
    });
  }, []);

  /** Store a fresh story list from Jira without re-analyzing (keeps position in the list). */
  const updateEpicStories = useCallback((epicKey: string, patch: Pick<EpicContext, "stories"> & Partial<Pick<EpicContext, "epicSummary" | "epicDescription" | "browseUrl">>) => {
    setEpics((prev) => {
      const next = prev.map((e) => (e.epicKey === epicKey ? { ...e, ...patch, storiesFetchedAt: new Date().toISOString() } : e));
      saveToStorage(next);
      return next;
    });
  }, []);

  const getEpic = useCallback(
    (epicKey: string) => epics.find((e) => e.epicKey === epicKey),
    [epics]
  );

  /** Saved epic for a story: by its Jira parent first, then by the stories included at analysis time. */
  const findEpicByStoryKey = useCallback(
    (storyKey: string, epicKey?: string) => {
      const analyzed = epics.filter((e) => e.contextBlock);
      return (epicKey ? analyzed.find((e) => e.epicKey === epicKey) : undefined) ??
        analyzed.find((e) => e.analyzedStoryKeys.includes(storyKey));
    },
    [epics]
  );

  return { epics, saveEpic, deleteEpic, updateEpicStories, getEpic, findEpicByStoryKey };
}
