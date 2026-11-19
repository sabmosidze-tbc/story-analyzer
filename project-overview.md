# StoryAnalyzer — Project Overview

A Next.js 16 app for QA engineers. It loads Jira stories and epics, analyzes them with AI (GitHub Copilot), and produces explanations, test design scenarios, test cases, checklists and bug reports that can be posted back to Jira or exported. See `README.md` for setup and a feature tour.

---

## Tech stack

| Layer | Technology |
|---|---|
| Framework | Next.js 16 (App Router), React, TypeScript |
| Styling | Tailwind CSS v4, dark mode |
| AI | GitHub Copilot SDK (per-user GitHub login). Optional OpenAI / Anthropic keys |
| GitHub login | NextAuth + GitHub OAuth device flow (`src/lib/github-device.ts`) |
| Jira | Atlassian remote MCP server with per-user OAuth (`@modelcontextprotocol/sdk`) |
| Exports | jsPDF, Excel (`results-xlsx.ts`), Jira comments |
| Storage | Browser `localStorage` for analyses and settings; `.data/` folder for login secrets |

---

## Zero-config setup

No `.env.local` and no tokens are needed.

- **Login cookie key** — `src/lib/local-secret.ts` creates a random `AUTH_SECRET` in `.data/` on first run.
- **GitHub** — device flow with the shared, public OAuth Client ID. The user's GitHub token drives their own Copilot.
- **Jira** — "Connect Jira" (sidebar) runs OAuth against Atlassian's MCP server. Tokens are stored per user in `.data/atlassian.json` and refreshed automatically. One sign-in works on every port (`localhost:3000`, `:3001`, …).

`.data/` is git-ignored. Deleting it signs everyone out on that machine.

---

## File structure

```
src/
├── auth.ts                     # NextAuth config (device flow, auto secret)
├── proxy.ts                    # Route protection
├── app/
│   ├── page.tsx                # Main page and orchestration state
│   ├── login/page.tsx          # Sign-in page (DeviceLogin)
│   └── api/
│       ├── analyze/            # Story, explanation, scenarios, epic analysis (streaming)
│       ├── atlassian/          # connect, callback, status (Jira MCP OAuth)
│       ├── login/device/       # GitHub device-flow start/poll
│       ├── copilot/models/     # Available Copilot models
│       ├── report/polish/      # AI polish for bug reports
│       └── jira/               # fetch, preview, projects, labels, board, epic-context,
│                               # bug-meta, issue (create/edit/load), comment, attachment
├── components/                 # UI (StoryInput, EpicAnalyzer, ReportIssueModal,
│                               # ReportsPanel, ChecklistTab, TestDesignPanel,
│                               # JiraConnect, DeviceLogin, ErrorNotice, ...)
├── hooks/                      # useHistory, useEpicLibrary, useCopilotModels, useTheme
├── lib/
│   ├── atlassian-mcp.ts        # MCP OAuth, token store, client cache, jiraFor()
│   ├── jira-server.ts          # Jira helpers on top of MCP tools
│   ├── adf-html.ts             # ADF <-> HTML conversion
│   ├── copilot-sdk.ts          # Copilot SDK calls
│   ├── github-device.ts        # Device flow + Client ID
│   ├── github-session.ts       # Session/token helpers
│   ├── local-secret.ts         # Auto-generated AUTH_SECRET
│   └── bug-report.ts, test-design.ts, epic.ts, results-xlsx.ts, ...
└── types/
```

---

## How Jira calls work

All `/api/jira/*` routes call MCP tools through `jiraFor(userId, origin)` in `atlassian-mcp.ts`. The `cloudId` is filled in automatically.

- Reads: `getJiraIssue`, `searchJiraIssuesUsingJql`, project/issue-type metadata.
- Writes: `createJiraIssue`, `editJiraIssue`, `addOrEditJiraIssueComment`.
- Attachments: `uploadAttachmentToJiraIssue` (two phases: upload bytes to Atlassian media, then attach). Deleting attachments is not supported by MCP.

If the user hasn't connected Jira, routes return `401` with `needsAtlassian: true`. `JiraConnect` listens for this and the UI shows a "Jira isn't connected" prompt with a Connect button (`ErrorNotice`).

---

## Data storage

| What | Where |
|---|---|
| Analyses, history, epic library | `localStorage` |
| My bugs, bug defaults, environments | `localStorage` |
| Copilot model choice, theme | `localStorage` |
| Login cookie key, Jira tokens | `.data/` (server, git-ignored) |

Nothing is stored in a database. A fresh clone or another browser starts empty.

---

## Optional settings (`.env.local`)

| Variable | Purpose |
|---|---|
| `COPILOT_MODEL` | Default Copilot model |
| `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` | Alternative AI providers |
| `JIRA_BASE_URL` | Pick a site if the account has access to several Jira sites |

---

## Known limitations

- History is per browser; it is not shared between users or devices.
- GitHub sign-in lasts 8 hours.
- Attachments can't be deleted from the app.
