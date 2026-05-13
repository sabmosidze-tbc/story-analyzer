import { NextRequest, NextResponse } from "next/server";
import { Analysis } from "@/types";

const SYSTEM_PROMPT = `You are a senior QA engineer. Analyze the provided Jira story/requirement text and produce a structured QA breakdown. Base your analysis ONLY on the provided text. If something is unclear or missing, explicitly state it. Never invent requirements.

Return a JSON object with this exact structure:
{
  "explanation": {
    "title": "Story Explanation",
    "content": "markdown content here"
  },
  "deskCheck": {
    "title": "Desk Check Scenarios & Edge Cases", 
    "content": "markdown content here"
  },
  "testSuggestions": {
    "title": "Unit & Integration Test Suggestions",
    "content": "markdown content here"
  }
}

For explanation content include:
- ## Simple Explanation
- ## Business Purpose
- ## Main User Goal
- ## System Changes
- ## Affected Areas (users/flows/pages/APIs/services/modules)
- ## Unclear / Missing / Ambiguous Requirements

For deskCheck content include:
- ## Happy Path Scenarios
- ## Negative Scenarios
- ## Edge Cases
- ## Validation Scenarios
- ## Permission / Access Cases (if relevant)
- ## Data-Related Scenarios (if relevant)
- ## UI / API / Backend Behavior
- ## Questions to Discuss with Developer / Product Owner
- ## What Should Be Confirmed Before Testing

For testSuggestions content include:
- ## Unit Tests
- ## Integration Tests
- ## Automation vs Manual QA
- ## Developer Discussion Points`;

function extractKeyPhrases(text: string): string[] {
  const stopWords = new Set([
    "the","a","an","is","are","was","were","be","been","being","have","has","had",
    "do","does","did","will","would","could","should","may","might","must","shall",
    "and","or","but","if","then","else","when","where","while","as","at","by",
    "for","in","of","on","to","up","with","from","into","through","about","after",
    "before","between","during","without","within","along","across","behind","beyond",
    "plus","except","but","up","out","around","down","off","above","below","so","that",
    "this","these","those","it","its","they","them","their","we","our","us","you","your",
    "he","she","him","her","his","i","my","me","not","no","nor","yet","both","either",
    "each","all","any","both","few","more","most","other","some","such","can","user",
    "users","system","able","need","needs","allow","allows","make","makes","also",
  ]);

  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s\-_]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 3 && !stopWords.has(w));

  const freq: Record<string, number> = {};
  for (const w of words) freq[w] = (freq[w] || 0) + 1;

  return Object.entries(freq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([w]) => w);
}

function extractSentences(text: string): string[] {
  return text
    .split(/[.!?\n]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 15);
}

function ruleBasedAnalysis(story: string): Analysis {
  const keyPhrases = extractKeyPhrases(story);
  const sentences = extractSentences(story);
  const firstSentence = sentences[0] ?? story.slice(0, 120);
  const hasUI = /\b(button|form|page|screen|modal|input|dropdown|click|display|show|render|ui|ux|interface)\b/i.test(story);
  const hasAPI = /\b(api|endpoint|request|response|rest|graphql|http|post|get|fetch|call)\b/i.test(story);
  const hasAuth = /\b(auth|login|logout|role|permission|access|token|session|user|admin)\b/i.test(story);
  const hasDB = /\b(database|db|table|record|store|save|persist|query|sql|model|data)\b/i.test(story);
  const phraseList = keyPhrases.length > 0 ? keyPhrases.map((p) => `\`${p}\``).join(", ") : "_(none detected)_";

  const explanation = `## Simple Explanation
${firstSentence}. This story describes: ${keyPhrases.slice(0, 4).join(", ") || "requirements that need clarification"}.

## Business Purpose
Based on the text, the business purpose appears to be: **${keyPhrases.slice(0, 3).join(" / ") || "unclear — story lacks business context"}**. The following key concepts are mentioned: ${phraseList}.

## Main User Goal
The main user goal derived from the text: _"${firstSentence}"_

## System Changes
${hasUI ? "- **UI changes** detected (buttons, forms, pages, modals mentioned)\n" : ""}${hasAPI ? "- **API/endpoint changes** detected\n" : ""}${hasDB ? "- **Data/persistence changes** detected\n" : ""}${hasAuth ? "- **Auth/permission changes** detected\n" : ""}${!hasUI && !hasAPI && !hasDB && !hasAuth ? "- No specific system layers clearly identified in the text. Clarify with the developer which layers are affected.\n" : ""}

## Affected Areas
${hasUI ? "- Frontend / UI layer\n" : ""}${hasAPI ? "- API / Backend services\n" : ""}${hasDB ? "- Database / Data persistence\n" : ""}${hasAuth ? "- Authentication / Authorization\n" : ""}- Any services or modules referencing: ${keyPhrases.slice(0, 5).join(", ") || "_(not specified)_"}

## Unclear / Missing / Ambiguous Requirements
${sentences.length < 3 ? "- **Story is very short** — most details are missing.\n" : ""}- Acceptance criteria: ${/accept|criteria|given|when|then/i.test(story) ? "partially present" : "**not found in text**"}.
- Error handling behavior: ${/error|fail|invalid|exception/i.test(story) ? "mentioned" : "**not specified**"}.
- Edge cases: ${/edge|corner|boundary|limit/i.test(story) ? "partially mentioned" : "**not specified**"}.
- Non-functional requirements (performance, security, accessibility): ${/performance|security|accessib|a11y|load|speed/i.test(story) ? "partially mentioned" : "**not specified**"}.`;

  const deskCheck = `## Happy Path Scenarios
${sentences.slice(0, 3).map((s, i) => `${i + 1}. Verify: "${s}"`).join("\n")}
${sentences.length === 0 ? "1. _(No sentences extracted — story text is too short to derive scenarios)_" : ""}

## Negative Scenarios
- What happens when required fields are empty or missing?${hasAPI ? "\n- What happens when the API returns a non-2xx status code?" : ""}${hasAuth ? "\n- What happens when an unauthorized user attempts the action?" : ""}
- What happens when the network is unavailable?

## Edge Cases
- Minimum and maximum data inputs (empty string, very long string, special characters)
- Concurrent requests / simultaneous actions by multiple users
- Browser refresh mid-flow${hasUI ? "\n- Mobile / small screen rendering" : ""}

## Validation Scenarios
- Required fields: ${keyPhrases.slice(0, 3).join(", ") || "_(not specified)_"} — confirm which are mandatory
- Data format validation (dates, emails, numbers) if applicable
- Duplicate entry handling${hasDB ? "\n- Database constraints (unique, not-null, foreign key)" : ""}

## Permission / Access Cases${hasAuth ? `
- Verify each role (admin, regular user, guest) can/cannot access the feature
- Test token expiry behaviour
- Verify correct redirect on unauthorized access` : `
- _(Auth/permission aspects not explicitly mentioned in the story — clarify if relevant)_`}

## Data-Related Scenarios${hasDB ? `
- Verify data is correctly saved / retrieved
- Test with empty dataset and large dataset
- Verify data integrity after update / delete operations` : `
- _(No explicit data persistence mentioned — confirm if data needs to be stored)_`}

## UI / API / Backend Behavior${hasUI ? `
- Verify loading states / spinners are shown during async operations
- Verify error messages are user-friendly
- Verify responsive layout on desktop, tablet, and mobile` : ""}${hasAPI ? `
- Verify correct HTTP status codes are returned
- Verify request/response payload matches the contract
- Verify API handles malformed input gracefully` : ""}
${!hasUI && !hasAPI ? "- _(System layer not clearly specified — confirm with developer what needs testing)_" : ""}

## Questions to Discuss with Developer / Product Owner
- What are the exact acceptance criteria for this story?
- Are there any performance requirements?
- Which environments need to be tested (dev, staging, prod)?
- Are there any feature flags or rollout strategies?

## What Should Be Confirmed Before Testing
- Dev environment is set up and the feature is deployed
- Test data is available
- All API contracts/mocks are in place
- Design/wireframes reviewed (if UI changes)`;

  const testSuggestions = `## Unit Tests
${hasUI ? "- Test each UI component renders correctly with various props\n- Test form validation logic in isolation\n- Test state transitions (loading, success, error)\n" : ""}${hasAPI ? "- Test each service/function with mocked HTTP responses\n- Test input sanitization and validation functions\n" : ""}${hasDB ? "- Test repository/data-access functions with an in-memory or test database\n- Test data mapping/transformation logic\n" : ""}- Test any utility functions related to: ${keyPhrases.slice(0, 4).join(", ") || "_(key modules not identified)_"}
- Test error/exception paths for every public function

## Integration Tests
${hasAPI && hasDB ? "- Test full request → service → database round-trip\n- Test API response shape matches contract\n" : ""}${hasAuth ? "- Test authenticated and unauthenticated flows end-to-end\n- Test role-based access control at the integration level\n" : ""}${hasUI && hasAPI ? "- Test UI component fetches data from API and renders result correctly\n" : ""}- Ensure the feature works correctly when integrated with existing modules

## Automation vs Manual QA
**Automate:**
- Happy path end-to-end flow
- Regression suite for affected areas: ${keyPhrases.slice(0, 3).join(", ") || "_(to be determined)_"}
- API contract tests${hasAuth ? "\n- Auth/permission checks" : ""}

**Manual:**
- Exploratory testing around edge cases
- Visual / UX review${hasUI ? " (layout, responsiveness, animations)" : ""}
- Accessibility check (keyboard navigation, screen reader)

## Developer Discussion Points
- Request unit tests for all new functions/methods introduced
- Confirm test coverage targets (recommend ≥ 80% for new code)
- Ask whether existing integration tests need updating
- Discuss mocking strategy for external dependencies${hasAPI ? " (API calls)" : ""}${hasDB ? " (database)" : ""}
- Confirm CI pipeline will run all tests on every PR`;

  return {
    explanation: { title: "Story Explanation", content: explanation },
    deskCheck: { title: "Desk Check Scenarios & Edge Cases", content: deskCheck },
    testSuggestions: { title: "Unit & Integration Test Suggestions", content: testSuggestions },
  };
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const story: string = body?.story ?? "";

    if (!story || story.trim().length === 0) {
      return NextResponse.json({ error: "Story text is required." }, { status: 400 });
    }

    const apiKey = process.env.OPENAI_API_KEY;

    if (apiKey) {
      const { default: OpenAI } = await import("openai");
      const openai = new OpenAI({ apiKey });

      const chat = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: story },
        ],
        temperature: 0.3,
      });

      const raw = chat.choices[0]?.message?.content ?? "{}";
      const analysis: Analysis = JSON.parse(raw);
      return NextResponse.json(analysis);
    }

    // Rule-based fallback
    const analysis = ruleBasedAnalysis(story);
    return NextResponse.json(analysis);
  } catch (err) {
    console.error("analyze error", err);
    return NextResponse.json({ error: "Analysis failed. Please try again." }, { status: 500 });
  }
}
