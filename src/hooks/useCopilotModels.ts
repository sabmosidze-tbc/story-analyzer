"use client";

import { useEffect, useState } from "react";

export interface CopilotModelOption {
  id: string;
  label: string;
}

const STORAGE_KEY = "story-analyzer:model";

// Shared across components so the model list is only fetched once per page load
let modelsPromise: Promise<{ models: CopilotModelOption[]; defaultModel: string | null; error?: string }> | null = null;

function fetchModels() {
  if (!modelsPromise) {
    modelsPromise = fetch("/api/copilot/models")
      .then(async (r) => {
        const data = await r.json().catch(() => ({})) as { models?: CopilotModelOption[]; defaultModel?: string | null; error?: string };
        if (r.status === 401) window.location.assign(`/login?callbackUrl=${encodeURIComponent(location.pathname + location.search)}`);
        if (!r.ok) modelsPromise = null;
        return { models: data.models ?? [], defaultModel: data.defaultModel ?? null, error: data.error };
      })
      .catch(() => {
        modelsPromise = null;
        return { models: [], defaultModel: null, error: "Failed to load Copilot models" };
      });
  }
  return modelsPromise;
}

/** Copilot models available to the signed-in Copilot account, plus the user's persisted choice. */
export function useCopilotModels() {
  const [models, setModels] = useState<CopilotModelOption[]>([]);
  const [model, setModelState] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchModels().then(({ models, defaultModel, error }) => {
      if (cancelled) return;
      setModels(models);
      setError(error ?? null);
      const saved = localStorage.getItem(STORAGE_KEY);
      const valid = saved && models.some((m) => m.id === saved) ? saved : defaultModel ?? undefined;
      setModelState(valid);
    });
    return () => { cancelled = true; };
  }, []);

  const setModel = (id: string) => {
    setModelState(id);
    localStorage.setItem(STORAGE_KEY, id);
  };

  return { models, model, setModel, error };
}
