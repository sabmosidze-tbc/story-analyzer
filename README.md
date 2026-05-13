# StoryAnalyzer

A modern web application that helps QA testers analyze Jira stories and requirements. Paste any story, ticket description, or acceptance criteria and instantly receive a structured QA breakdown.

## Features

- **Story Explanation** — Simple explanation, business purpose, user goal, system changes, and ambiguous requirements
- **Desk Check Scenarios & Edge Cases** — Happy path, negative scenarios, edge cases, validation, permissions, and questions to discuss with developers
- **Unit & Integration Test Suggestions** — Clearly separated test ideas with automation vs. manual notes and developer discussion points
- **History sidebar** — All analyses are saved locally in the browser; reopen, rename, or delete previous analyses
- **Copy & Export** — Copy individual sections or all output; export as Markdown
- **AI-powered** — Uses OpenAI `gpt-4o-mini` when an API key is configured, with a smart rule-based fallback for demo/offline use

## Getting Started

### 1. Install dependencies

```bash
npm install
```

### 2. (Optional) Configure OpenAI API key

Copy the example env file and add your key for AI-powered analysis:

```bash
cp .env.local.example .env.local
# Edit .env.local and set OPENAI_API_KEY=your_key_here
```

If no key is set, the app runs in **demo mode** using a rule-based analyzer that is still grounded in your input text.

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

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 14+ (App Router) |
| Language | TypeScript |
| Styling | Tailwind CSS + `@tailwindcss/typography` |
| Icons | `lucide-react` |
| Markdown | `react-markdown` |
| AI | OpenAI `gpt-4o-mini` (optional) |
| Persistence | Browser `localStorage` |

## Project Structure

```
src/
├── app/
│   ├── api/analyze/route.ts   # Analysis API (OpenAI or rule-based)
│   ├── layout.tsx
│   └── page.tsx               # Main app page
├── components/
│   ├── AnalysisCard.tsx       # Individual analysis block with copy/export
│   ├── EmptyState.tsx         # Empty state shown before first analysis
│   ├── Header.tsx             # Mobile top bar
│   ├── Sidebar.tsx            # History sidebar
│   └── StoryInput.tsx         # Story input form
├── hooks/
│   └── useHistory.ts          # localStorage persistence hook
└── types/
    └── index.ts               # TypeScript interfaces
```

## Deployment

Deploy to [Vercel](https://vercel.com) in one click — just set the `OPENAI_API_KEY` environment variable in your project settings.
