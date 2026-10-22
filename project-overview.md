# Story Analyzer — Project Overview

## What is this project?

Story Analyzer is a Next.js 15 web application that allows QA engineers and business analysts to paste a Jira story, user requirement, or acceptance criteria text and receive a structured, AI-generated analysis. The analysis is designed to be detailed enough for a tester with no domain knowledge to build test cases directly from it without needing to re-read the original story.

The app uses the GitHub Models API (via a user-supplied `GITHUB_TOKEN`) to call various OpenAI and third-party LLM models, and produces a six-section breakdown: Story Explanation, Ambiguities, Assumptions, Open Questions, Desk Check Scenarios, and Unit/Integration Test Suggestions. Responses stream progressively to the browser via Server-Sent Events — the first sections appear within seconds of submission.

---

## Tech Stack

| Layer | Technology |
|-------|------------|
| Framework | Next.js 15 (App Router, `"use client"` components) |
| Language | TypeScript throughout |
| Styling | Tailwind CSS v4 with dark mode (`dark:` prefix) |
| AI API | GitHub Models (`https://models.github.ai/inference`) via OpenAI SDK |
| PDF export | jsPDF (dynamic import, no SSR) |
| Markdown render | react-markdown |
| Icons | lucide-react |
| State persistence | Browser `localStorage` |
| Voice input | Web Speech API (browser-native, no library) |

---

## File Structure

```
src/
├── app/
│   ├── page.tsx              # Main page — all orchestration state lives here
│   ├── layout.tsx            # Root layout, dark mode class, fonts
│   ├── globals.css           # Tailwind base styles
│   └── api/
│       └── analyze/
│           └── route.ts      # POST /api/analyze — SSE streaming response
├── components/
│   ├── StoryInput.tsx        # Textarea, model selector, mic button, analyze/cancel
│   ├── AnalysisCard.tsx      # Renders one markdown analysis section with copy + PDF export
│   ├── StructuredListCard.tsx# Renders structured lists (ambiguities/assumptions/questions) with copy + Jira table + PDF
│   ├── Sidebar.tsx           # Chat history list with search, rename/delete/spinner
│   ├── Header.tsx            # Top bar with logo, menu toggle, theme toggle
│   └── EmptyState.tsx        # Landing illustration when no chat is selected
├── hooks/
│   ├── useHistory.ts         # localStorage read/write for chat history
│   └── useTheme.ts           # Dark/light mode toggle with system preference
└── types/
    └── index.ts              # Shared TypeScript interfaces
```

---

## Core Functionality

### 1. New Analysis Flow

1. User opens the app — sees an empty `StoryInput` form with a textarea.
2. User pastes a Jira story or requirement text. The textarea shows a live character and word count.
3. User selects a model from the dropdown (default: GPT-4o mini).
4. User clicks **Analyze Story** or presses **Ctrl+Enter** (Cmd+Enter on macOS).
5. A "pending" entry is immediately added to the top of the sidebar with a spinner (optimistic UI).
6. The form submits to `POST /api/analyze` with `{ story, model }`.
7. The API streams back Server-Sent Events. As each JSON section completes in the stream, the corresponding card appears instantly — sections are progressively rendered with skeleton placeholders for missing ones.
8. The entry is finalized in the sidebar (spinner disappears, smart title shown) and floated to the top of the list.
9. The full action bar (Copy All, Export Full PDF, metadata badges) is revealed once streaming completes.

### 2. Reanalyze Existing Chat

1. When a past chat is selected, a compact "Reanalyze" bar is shown instead of the full textarea.
2. Clicking **Reanalyze** opens the full `StoryInput` with the previous text pre-filled.
3. The user can edit the text and submit — this replaces the previous analysis for that chat.
4. While re-analysis is running, the sidebar shows a spinner for that specific entry.
5. If the user navigates to another chat mid-edit, their draft text is preserved when they come back (per-chat draft state).

### 3. Chat History (Sidebar)

- All analyses are stored in `localStorage` under key `story-analyzer-history`.
- Each entry has: `id`, `title` (smart title from "As a…" pattern, Jira ID, first line, or first 7 words), `storyText`, `analysis`, `isPending`, `createdAt`, `updatedAt`.
- The sidebar shows all entries ordered newest/most-recently-analyzed first.
- A **search box** at the top filters entries by title or story text in real time.
- Users can **rename** entries (inline double-click or edit icon).
- Users can **delete** entries (with confirmation via trash icon).
- Entries with `isPending: true` (mid-analysis when page was last closed) are filtered out on load.
- Multiple analyses can run concurrently — each has an independent spinner.
- Completing or reanalyzing any entry floats it to the top of the list.

### 4. Concurrent Analysis Safety

- `loadingIds: Set<string>` tracks which chat IDs are currently loading.
- All `useHistory` mutations use functional `setState` updates (never stale closures) — this prevents race conditions when two analyses complete in quick succession.
- When a new analysis is started while another is running, both run independently and finalize their own entries without overwriting each other.

### 5. Copy & Export

**Per-section markdown cards (each `AnalysisCard`):**
- **Copy** — copies the raw markdown content of that section to clipboard.
- **Export PDF** — exports only that section as a formatted PDF (colored header banner, sub-heading accents, bullet dots, numbered list).

**Per-section structured list cards (each `StructuredListCard` for ambiguities / assumptions / open questions):**
- **Copy** — copies items as a numbered list.
- **Jira Table** — copies as Jira wiki markup table format (`|| # || Item ||` header, `| N | text |` rows) ready to paste into Confluence or Jira description fields.
- **Export PDF** — exports the list section as a PDF.

**Full report (top action bar, shown after streaming completes):**
- **Copy All** — copies all six sections as a single markdown document.
- **Export Full PDF** — exports a complete multi-section PDF report with a title page, date, dividers, and all sections with their respective color themes.

### 6. Model Selection

Available model groups in the dropdown:
- **OpenAI · GPT-5** — `openai/gpt-5`, `openai/gpt-5-mini`
- **OpenAI · GPT-4** — `openai/gpt-4o`, `openai/gpt-4o-mini` (default), `openai/gpt-4.1`, `openai/gpt-4.1-mini`, `openai/gpt-4.1-nano`
- **OpenAI · Reasoning** — `openai/o4-mini`, `openai/o3-mini`
- **Other** — DeepSeek-R1, DeepSeek-V3, Mistral Small, Phi-4, Llama 3.3 70B
- **Custom model ID** — freeform text input for any GitHub Models model not in the list (e.g. `openai/gpt-5.4`)

Server-side validation allows any model with a known provider prefix (`openai/`, `deepseek/`, `mistral-ai/`, `microsoft/`, `meta/`, etc.) plus format safety check (alphanumeric/hyphens/dots/slash only, max 120 chars).

Reasoning models (`o1`, `o3-mini`, `o4-mini`, and any `openai/oN*` pattern) are sent without a `temperature` parameter since the API rejects it for those models.

### 7. Voice Input

- A microphone button appears in the `StoryInput` toolbar (only in browsers that support the Web Speech API — Chrome, Edge, Safari).
- Clicking the mic starts continuous speech recognition.
- The button turns red and pulses while recording; the textarea border also turns red.
- Interim transcription is shown live in the textarea.
- Final results are accumulated in a ref; interim text is displayed on top.
- Clicking the mic again (now showing MicOff icon) or finishing speech stops recording and finalizes the text.
- Voice text is appended to whatever was already in the textarea.

### 8. Theme (Dark / Light Mode)

- Managed by the `useTheme` hook.
- Respects the OS/browser `prefers-color-scheme` setting on first load.
- User preference is persisted to `localStorage`.
- Toggled via the sun/moon icon in the `Header`.

---

## API Route — `POST /api/analyze`

**Request body:**
```json
{ "story": "string (the Jira story text)", "model": "string (model ID)" }
```

**Response format:** Server-Sent Events (`Content-Type: text/event-stream`)

Each event is a line starting with `data: ` followed by a JSON object, terminated by `\n\n`.

| Event type | Payload | When sent |
|------------|---------|-----------|
| `chunk` | `{ type: "chunk", text: "..." }` | Each streamed token batch from the LLM |
| `done` | `{ type: "done", tokenUsage?: {...}, meta?: {...} }` | Stream complete; carries final metadata |
| `error` | `{ type: "error", error: "..." }` | LLM call failed inside the stream |

The client accumulates `text` chunks and progressively parses completed JSON sections as they arrive.

**Behavior:**
- If `GITHUB_TOKEN` is set: uses `https://models.github.ai/inference` as OpenAI-compatible base URL.
- If `OPENAI_API_KEY` is set: uses OpenAI directly (bare model names without vendor prefix).
- If neither is set: falls back to rule-based static analysis, sent as a single `chunk` event.
- The system prompt instructs the model to produce 8 sub-sections in the explanation, 10 in the desk check, and 4 in test suggestions, plus ambiguities/assumptions/open questions lists.

**Error handling:**
- `no_access` / `403` errors are surfaced with a human-readable message about GitHub token permissions.
- Errors inside the stream generator are sent as SSE `error` events.
- Errors before the stream starts (body parse, input validation) return a standard JSON 400/500 response.

---

## State Management (page.tsx)

All orchestration state lives in the single `Home` component in `page.tsx`:

| State | Type | Purpose |
|-------|------|---------|
| `selectedId` | `string \| null` | Currently viewed chat |
| `selectedIdRef` | `useRef` | Cross-async ref to avoid stale closures in async callbacks |
| `currentAnalysis` | `Partial<Analysis> \| null` | Analysis displayed on screen; partial during streaming |
| `loadingIds` | `Set<string>` | IDs of chats currently being analyzed |
| `reanalyzeStates` | `Record<string, {show, text}>` | Per-chat draft state for the reanalyze textarea |
| `error` | `string \| null` | Error message banner |
| `sidebarOpen` | `boolean` | Mobile sidebar overlay |
| `allCopied` | `boolean` | "Copied!" flash state for Copy All button |

---

## useHistory Hook

Manages the `localStorage` chat history. All mutations use **functional setState** (`setEntries(prev => ...)`) to prevent race conditions when multiple async operations complete simultaneously.

| Function | Description |
|----------|-------------|
| `addPendingEntry(storyText)` | Adds entry with `isPending: true`, no analysis. Prepends to list. Returns the entry. |
| `finalizeEntry(id, analysis)` | Sets analysis + `isPending: false`. Moves entry to the top of the list. |
| `updateEntry(id, storyText, analysis)` | Replaces text + analysis for a reanalyzed entry. Moves entry to the top of the list. |
| `removeEntry(id)` | Deletes an entry. |
| `renameEntry(id, title)` | Updates the title. |
| `getEntry(id)` | Returns the entry object (reads from React state). |

---

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `GITHUB_TOKEN` | Recommended | Personal Access Token with `models:read` scope. Used to call GitHub Models API. |
| `OPENAI_API_KEY` | Optional | Direct OpenAI API key (fallback if `GITHUB_TOKEN` not set). |

If neither is set, the app falls back to rule-based analysis (no AI, keyword extraction only).

---

## Known Limitations & Future Enhancement Areas

1. **No user authentication** — history is per-browser, not synced across devices.
2. **No story templates** — users must know how to format a Jira story.
3. **No custom system prompt** — users cannot modify the analysis instructions without editing the source code.
4. **No export to Jira/Confluence** — analysis can only be copied/PDF-exported, not pushed back to a project management tool (though Jira Table copy helps).
5. **Rule-based fallback is shallow** — without an API key, the analysis is keyword-based and not useful for real QA work.
6. **Voice input is English-only** — `recognition.lang` is hardcoded to `en-US`.
7. **No analysis comparison** — no way to diff two analyses for the same story.
8. **No team sharing** — no backend, so analyses cannot be shared between team members.
9. **PDF formatting limitations** — jsPDF free tier has no inline bold/italic, so `**bold**` markers are stripped; tables in AI output are flattened to plain text.
