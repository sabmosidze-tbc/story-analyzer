# StoryAnalyzer

A QA-focused web application that turns Jira stories and requirements into structured analysis: desk-check scenarios, test suggestions, ambiguities, assumptions, and open questions. Supports AI analysis via GitHub Models (free, requires a PAT) and GitHub Copilot (your personal subscription, requires OAuth login).

## Features

- **Story Explanation** — plain-English breakdown, business purpose, step-by-step user flow, technical implementation notes
- **Desk Check Scenarios** — happy path, negative cases, edge cases, validation, permissions, dark-mode considerations
- **Unit & Integration Test Suggestions** — separated unit/integration ideas, automation vs. manual guidance, developer discussion points
- **Ambiguities, Assumptions, Open Questions** — structured lists extracted directly from the story text
- **Inline editing** — every card is editable after generation; save your corrections before copying or posting to Jira
- **Jira integration** — paste a Jira key or URL to auto-load the story; post individual sections as Jira comments
- **History sidebar** — all analyses saved in browser `localStorage`; rename, reopen, or delete
- **Multiple AI models** — GPT-4.1, o3, DeepSeek, Grok, Claude, Llama, Mistral, Phi via GitHub Models; Copilot-tier models (Claude Sonnet/Opus, GPT-4.5, …) via GitHub OAuth
- **Dark mode** — fully supported, respects system preference

---

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Create `.env.local`

Create a file named `.env.local` in the project root with the variables below. Only `GITHUB_TOKEN` is required for basic AI analysis; the rest unlock additional features.

```env
# ── AI: GitHub Models (required for AI analysis) ────────────────────────────
# Create a Personal Access Token at https://github.com/settings/tokens
# Token type: Fine-grained or Classic — must have the "models" scope (read-only)
GITHUB_TOKEN=github_pat_...

# ── Jira integration (optional) ─────────────────────────────────────────────
# Your Jira Cloud base URL (no trailing slash)
JIRA_BASE_URL=https://yourcompany.atlassian.net
# The email address you use to log in to Jira
JIRA_EMAIL=you@yourcompany.com
# Generate an API token at: https://id.atlassian.com/manage-profile/security/api-tokens
JIRA_API_TOKEN=ATATT3x...

# ── GitHub OAuth (optional — unlocks GitHub Copilot models) ─────────────────
# Needed only if you want to use Copilot-tier models (Claude, GPT-4.5, etc.)
# tied to your personal GitHub Copilot subscription.
#
# How to set up:
#   1. Go to https://github.com/settings/developers → OAuth Apps → New OAuth App
#   2. Fill in:
#        Application name:        StoryAnalyzer (anything)
#        Homepage URL:            http://localhost:3000
#        Authorization callback URL: http://localhost:3000/api/auth/callback/github
#   3. Click "Register application"
#   4. Copy the Client ID → AUTH_GITHUB_ID
#   5. Click "Generate a new client secret" → AUTH_GITHUB_SECRET
#   6. Generate AUTH_SECRET with PowerShell:
#        [System.Convert]::ToBase64String((1..32 | ForEach-Object { [byte](Get-Random -Max 256) }))
#      or on macOS/Linux:  openssl rand -base64 32
#
# These values are permanent — generate once and keep them.
AUTH_GITHUB_ID=
AUTH_GITHUB_SECRET=
AUTH_SECRET=
# Required: tells Auth.js the app's base URL so OAuth callbacks are constructed correctly
AUTH_URL=http://localhost:3000
```

### 3. Run the development server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

### 4. Build for production

```bash
npm run build
npm start
```

For production, set the same environment variables in your hosting platform's settings (e.g. Vercel project settings). Change `Homepage URL` and `Authorization callback URL` in the GitHub OAuth App to your production domain.

---

## Model tiers

| Tier | How it works | Models available |
|---|---|---|
| **GitHub Models** (default) | Server uses `GITHUB_TOKEN` PAT → `models.github.ai` | GPT-4o, GPT-4.1, o3, o4-mini, DeepSeek-R1, Grok 3, Llama 4, Mistral, Phi-4, … |
| **GitHub Copilot** (sign-in) | User signs in with GitHub → personal OAuth token → `api.githubcopilot.com` | All of the above + GPT-4.5, Claude 3.7 Sonnet, Claude Sonnet 4.5, Claude Opus 4.5 |

The Copilot tier uses **your own Copilot subscription quota**, not the server's PAT. It requires `AUTH_GITHUB_ID`, `AUTH_GITHUB_SECRET`, and `AUTH_SECRET` to be configured.

---

## Tech stack

| Layer | Technology |
|---|---|
| Framework | Next.js (App Router) |
| Language | TypeScript |
| Styling | Tailwind CSS v4 + `@tailwindcss/typography` |
| Icons | `lucide-react` |
| Markdown | `react-markdown` |
| PDF export | `jspdf` |
| AI | GitHub Models API / GitHub Copilot API (OpenAI-compatible) |
| Auth | Auth.js v5 (`next-auth@beta`) — GitHub OAuth provider |
| Persistence | Browser `localStorage` |

## Project structure

```
src/
├── auth.ts                          # Auth.js v5 config (GitHub OAuth)
├── app/
│   ├── api/
│   │   ├── analyze/route.ts         # SSE streaming analysis endpoint
│   │   ├── auth/[...nextauth]/      # Auth.js route handler
│   │   └── jira/
│   │       ├── fetch/route.ts       # Load full Jira story
│   │       ├── preview/route.ts     # Fetch ticket summary (banner)
│   │       └── comment/route.ts     # Post section as Jira comment
│   ├── layout.tsx
│   └── page.tsx                     # Main app page
├── components/
│   ├── AnalysisCard.tsx             # Markdown card with edit/copy/PDF/Jira
│   ├── StructuredListCard.tsx       # Numbered list card with inline item edit
│   ├── AuthButton.tsx               # GitHub sign-in / sign-out button
│   ├── AuthSessionProvider.tsx      # Client-side SessionProvider wrapper
│   ├── EmptyState.tsx
│   ├── Header.tsx                   # Mobile top bar
│   ├── Sidebar.tsx                  # History sidebar
│   └── StoryInput.tsx               # Story input form + model selector
├── hooks/
│   ├── useHistory.ts                # localStorage persistence hook
│   └── useTheme.ts                  # Dark mode hook
└── types/
    ├── index.ts                     # App TypeScript interfaces
    └── next-auth.d.ts               # Session type extensions
```
