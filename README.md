# StoryAnalyzer

A QA-focused web app. It loads Jira stories, analyzes them with AI, and produces scenarios, test cases and checklists you can export to Jira, Excel or PDF. It also helps you report bugs straight into Jira.

---

## 1. Setup

No config files and no tokens. You only install, run, and sign in twice.

### Requirements
- Node.js 20+ and npm
- A Jira Cloud account
- A GitHub account with an active **GitHub Copilot** subscription (the AI runs on it)

### Run

```bash
npm install
npm run dev
```

Open the address shown in the terminal (usually <http://localhost:3000>).

### Sign in
1. **GitHub.** Click **Sign in with GitHub**. The app shows a short code. Click **Open GitHub**, enter the code and press **Authorize**. The page continues by itself.
2. **Jira.** Click **Connect Jira** at the bottom of the sidebar. Log in with your Atlassian account and press **Accept**. You return to the app.

That's all. Each person uses their own GitHub (and own Copilot) and their own Jira account. Bugs and comments appear under your Jira name.

### What the app stores
On first run the app creates a `.data/` folder (ignored by git). It holds a random login-cookie key and your Jira sign-in. Delete it to sign everyone out on that computer.

### Notes
- A GitHub sign-in lasts **8 hours**.
- Jira connects through Atlassian's official MCP server, so no Atlassian app or API token is needed. If your company has more than one Jira site, set `JIRA_BASE_URL` to pick one.
- Attachments can be added from the app but not deleted; remove them in Jira.
- For the team owner: the shared GitHub OAuth App must have **Enable Device Flow** ticked. Its Client ID is public and lives in `src/lib/github-device.ts`.

Optional settings, in `.env.local`:

```env
COPILOT_MODEL=claude-sonnet-5.5   # default Copilot model
OPENAI_API_KEY=                   # alternative AI provider
ANTHROPIC_API_KEY=                # alternative AI provider
JIRA_BASE_URL=                    # only if you have access to several Jira sites
```

For a production build: `npm run build && npm start`.

### Troubleshooting

| Problem | Fix |
|---|---|
| "AI provider returned an empty response" | Sign in with GitHub and choose a Copilot model. Check that your account has Copilot. |
| "Device sign-in is turned off" | The OAuth App owner must tick **Enable Device Flow** in its GitHub settings. |
| "Connect Jira first" | Click **Connect Jira** in the sidebar. Your Jira sign-in may have expired. |
| Jira says you have no permission | Your own Jira account lacks access to that project. |
| Big uploads fail | Uploads are limited to 250 MB (`next.config.ts`). |

---
## 2. What the app does

### Story Analyzer
Paste a Jira key or URL (or raw text). The app loads the story and runs the analysis. Keys that are Bugs or Epics are rejected here with a clear message, since those have their own flows.

Results appear in tabs:
- **Explanation** – plain-English summary, business purpose, user flow, technical notes. Long text scrolls inside the card.
- **Scenarios** – test design scenarios with coverage, as bordered cards with Preconditions, Steps and Expected result.
- **Test Cases** – grouped test suggestions with a structured editor (what to check, input, expected).
- **Ambiguities / Assumptions / Open Questions** – extracted from the story. Tabs with no items are hidden.

Every section can be edited and posted to Jira as a comment.

### Update from Jira
If the ticket changed in Jira, **Update from Jira** compares the text. If nothing changed it says so. If it changed, it asks you to confirm before re-analyzing, so your current analysis is never replaced by accident.

### Checklist
Environment-based checklists for a story. Your list of environments (e.g. D02, Q01) is editable, saved in your browser, and shared with the bug form.

### Epic Analyzer
Select an epic to see its stories as cards and analyze the whole epic: context, how stories relate, and gaps. Epics can be opened and closed.

### Report a bug
Create a well-structured Jira Bug from inside the app:
- Multiple problems per card, each with steps, requests, expected and actual results.
- Screenshots and videos per section (paste, pick or drag in).
- Priority, components, **labels** (loaded from Jira only when you click the field) and environment.
- Links the bug to the story. The description uses a clean Jira layout with green Expected and red Actual panels.

### Bugs I reported
A personal list with live Jira status, search and scrolling.
- **Edit** (pencil) – change a bug and save back to Jira.
- **Update from Jira** (refresh icon) – pull the latest title and text if someone changed the ticket.
- **Load by key** – open any existing ticket (not Epics) to edit it, even if it became a Task or was reformatted.
- Items show **Not in Jira** if the ticket was deleted. Removing an item from the list never deletes anything in Jira. Entries older than 30 days are dropped from the list.
- Edit-save is only enabled when something changed.

### Observations
Log non-bug findings and track their state (open → fixed → retest passed/failed). Each state change posts a comment on the Jira ticket.

### API requests
Capture request details and attach them to bug reports.

### Exports
Export results to Excel (including Zephyr-style test cycles), PDF, and Jira comments.

### History & settings
All analyses are saved in your browser (`localStorage`). Rename, reopen or delete them from the sidebar. Dark mode follows your system.

---

## 3. Notes
- Data lives in the browser; nothing is stored on a server database.
- The app writes to Jira (bugs, comments, edits) as the signed-in Jira user. Use a test project first if unsure.
- This project uses Next.js 16, which has breaking changes from older versions. See `node_modules/next/dist/docs/` before changing framework-level code.
