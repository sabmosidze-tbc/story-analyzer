// ── Epic Context ─────────────────────────────────────────────────────────────

export interface EpicStory {
  key: string;
  summary: string;
  description: string; // full plain-text description
  status: string;
}

export interface EpicContext {
  epicKey: string;
  epicSummary: string;
  browseUrl?: string;           // e.g. https://company.atlassian.net/browse/PROJ-100
  storyCount: number;
  analyzedStoryKeys: string[];  // keys included in the analysis
  analyzedAt: string;           // ISO timestamp
  contextBlock: string;         // compact block injected into AI story prompts
  overviewDocument: string;     // human-readable synthesis for the tester to read
}

// ── Analysis ──────────────────────────────────────────────────────────────────

export interface AnalysisBlock {
  title: string;
  content: string;
}

export interface StructuredBlock {
  title: string;
  items: string[];
}

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  model: string;
}

export interface AnalysisMeta {
  model: string;
  duration: number;       // milliseconds
  isFallback: boolean;
  promptVersion: string;  // e.g. "v2"
  generatedTitle?: string;
}

export interface Analysis {
  explanation: AnalysisBlock;
  deskCheck: AnalysisBlock;
  testSuggestions: AnalysisBlock;
  // New structured sections — absent in old saved analyses (backward compat)
  ambiguities?: StructuredBlock;
  assumptions?: StructuredBlock;
  openQuestions?: StructuredBlock;
  // Analysis metadata — absent in old saved analyses (backward compat)
  meta?: AnalysisMeta;
  tokenUsage?: TokenUsage;
}

export type ChecklistStatus = "pending" | "passed" | "failed" | "clarification" | "blocked" | "na";

export interface ChecklistItem {
  id: string;
  category: string;
  description: string;
  status: ChecklistStatus;
}

export interface StoryEntry {
  id: string;
  title: string;
  storyText: string;
  jiraKey?: string;
  jiraUrl?: string;           // full browse URL, e.g. https://tbcbank.atlassian.net/browse/LSINST-1202
  jiraPostedSections?: Record<string, string>; // sectionTitle -> content fingerprint
  checklistPostedCategories?: string[];         // category names sent to Jira
  analysis?: Analysis;
  checklist?: ChecklistItem[];
  isPending?: boolean;
  createdAt: string;
  updatedAt: string;
}
