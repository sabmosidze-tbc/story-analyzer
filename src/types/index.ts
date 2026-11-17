// ── Epic Context ─────────────────────────────────────────────────────────────

import type { TestDesign } from "@/lib/test-design";
export type { TestDesign };

export interface EpicStory {
  key: string;
  summary: string;
  description: string; // full plain-text description
  status: string;
  type?: string;       // Story / Task / Bug…
  assignee?: string;
}

export interface EpicContext {
  epicKey: string;
  epicSummary: string;
  epicDescription?: string;
  browseUrl?: string;           // e.g. https://company.atlassian.net/browse/PROJ-100
  storyCount: number;
  analyzedStoryKeys: string[];  // keys included in the analysis
  analyzedAt: string;           // ISO timestamp
  contextBlock: string;         // compact block injected into AI story prompts
  overviewDocument?: string;    // legacy, no longer produced
  analysis?: import("@/lib/epic").EpicAnalysis;   // structured overview + test strategy
  stories?: EpicStory[];        // latest story list from Jira
  storiesFetchedAt?: string;
  analyzedHashes?: Record<string, string>;        // story key → content hash at analysis time
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
  deskCheck?: AnalysisBlock; // legacy — replaced by testDesign
  testSuggestions: AnalysisBlock;
  // New structured sections — absent in old saved analyses (backward compat)
  ambiguities?: StructuredBlock;
  assumptions?: StructuredBlock;
  openQuestions?: StructuredBlock;
  // Formal test design (EP / BVA / DT / ST) — absent in older analyses
  testDesign?: TestDesign;
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
  ref?: string;               // ID of the record the tester used, e.g. a loan ID
  apis?: ApiRequest[];        // requests the tester sent, each tied to a step
  /** @deprecated single request from older saves — read via itemApis() */
  api?: ApiRequest;
}

export interface ApiRequest {
  method: string;             // GET, POST, …
  url: string;                // endpoint, e.g. /api/loans/123/rate
  body?: string;              // payload (JSON is pretty-printed on save)
  step?: number;              // 1-based step it was sent in; undefined = not tied to a step
}

/** Observation lifecycle: dev fixes it, tester retests it. */
export type ObservationState = "open" | "fixed" | "retest-passed" | "retest-failed";

/** A bug card or an observation comment raised from this story. */
/** Everything needed to re-open a created bug for editing */
export interface BugSnapshot {
  draft: import("@/lib/bug-report").ReportDraft;
  projectKey: string;
  priorityId?: string;
  componentIds?: string[];
  labels?: string;
  envOptionId?: string;
  storyKey?: string;
  files: { id?: string; name: string; url?: string; group?: string; mediaId?: string; image?: boolean }[];
}

export interface IssueReport {
  id: string;
  kind: "bug" | "observation";
  title: string;
  itemId?: string;            // checklist test case it came from
  testCaseId?: string;        // e.g. "TC3"
  key?: string;               // bug: the new Jira key; observation: the story key
  url?: string;
  number?: number;            // observation #N on this story
  state?: ObservationState;   // observations only
  environment?: string;
  snapshot?: BugSnapshot;     // bugs only: lets the card be edited later
  createdAt: string;
  history?: { at: string; state: ObservationState; environment?: string; note?: string }[];
}

export interface StoryEntry {
  id: string;
  title: string;
  storyText: string;
  jiraKey?: string;
  epicKey?: string;           // parent epic in Jira, used to pick up saved epic context
  jiraUrl?: string;           // full browse URL, e.g. https://tbcbank.atlassian.net/browse/LSINST-1202
  jiraPostedSections?: Record<string, string>; // sectionTitle -> content fingerprint
  checklistPostedCategories?: string[];         // category names sent to Jira
  checklistRefLabel?: string;
  checklistEnvironment?: string;                // where the tests ran, e.g. "UAT"                   // column name for ChecklistItem.ref, e.g. "Loan ID"
  reports?: IssueReport[];      // bugs + observations raised from this story
  analysis?: Analysis;
  checklist?: ChecklistItem[];
  isPending?: boolean;
  createdAt: string;
  updatedAt: string;
}
