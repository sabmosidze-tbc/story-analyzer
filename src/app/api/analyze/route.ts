import { NextRequest, NextResponse } from "next/server";
import { getGitHubAccessToken, NOT_SIGNED_IN } from "@/lib/github-session";
import { Analysis } from "@/types";

const SYSTEM_PROMPT = `You are a senior QA engineer and business analyst writing for a QA tester audience. The tester may have no prior knowledge of this system, no business context, and no technical background — so your job is to give them everything they need to understand and test this story confidently, without having to ask anyone.

Your output must be so clear and detailed that:
- A QA tester who has never seen this system before can read it and know exactly what to test, how to test it, and what the expected results look like.
- A business stakeholder can read it and confirm the analysis is correct.
- No section should be shallow, generic, or copy-paste boilerplate — every point must be specific to THIS story's content.

GOLDEN RULE: Always explain the "why" alongside the "what". Do not just state facts — explain what they mean for the tester. Example: instead of "validate email field", write "The email field must be validated on the client side before submission so the user gets instant feedback. An invalid format (e.g. missing '@', trailing spaces, empty value) must show an inline error message directly below the field — the form must NOT submit, and no API call should be made."

STRICT RULES:
- Analyze ONLY what is in the provided story text. Do not invent requirements.
- If something is missing, ambiguous, or unclear: call it out explicitly in the relevant section and in the ambiguities/openQuestions lists.
- Never write a one-liner bullet. Every point needs enough detail that the tester knows exactly what to do.
- Use plain language. Avoid unexplained jargon. If you must use a technical term, define it in parentheses immediately after.
- Write as if you are the tester's more experienced colleague sitting next to them and explaining the story — friendly, precise, and thorough.
- DEPTH IS MANDATORY: each section must have at least 4–6 specific, concrete points. Generic statements like "test validation" are not acceptable.
- Reference specific story details (feature names, field names, roles, actions, data entities) in every bullet. Never write a generic bullet that could apply to any story.
- CRITICAL — FRONTEND/UI: Only mention frontend, UI, screens, buttons, forms, browser behavior, or client-side logic if the story text EXPLICITLY describes user interface changes, visual elements, or user interaction. Backend, data processing, calculation, or configuration stories often have zero frontend involvement — in those cases completely omit all frontend/UI content from every section. Never add frontend content as a guess or boilerplate.

Return ONLY a raw JSON object — do not wrap it in markdown code fences, backticks, or any other formatting. The response must start with { and end with }. Use this exact structure:
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
  },
  "ambiguities": {
    "title": "Ambiguities & Gaps",
    "items": ["specific ambiguity or gap identified in the story", "..."]
  },
  "assumptions": {
    "title": "Assumptions Made",
    "items": ["explicit assumption made during analysis where story was unclear", "..."]
  },
  "openQuestions": {
    "title": "Open Questions for BA / PO / Dev",
    "items": ["concrete question that must be answered before testing begins", "..."]
  },
  "generatedTitle": "A concise 5-8 word title capturing the essence of this story"
}

---

## EXPLANATION SECTION GUIDE

Write the explanation so a brand-new tester on day one can read it and fully understand what this feature is, why it exists, and how it works. Every section below is mandatory.

### Simple Explanation
Write 4–6 sentences in plain, conversational English. What does this feature do? Imagine explaining it to a smart person who has never heard of this system. Describe the state of the world BEFORE this feature exists, and what changes AFTER. Avoid all technical jargon — if you must use a term, explain it inline.

### Business Purpose
Why does this feature need to exist? What problem does it solve for the business or the user? What would go wrong, or what would the user be unable to do, if this feature did not exist? What is the measurable outcome or improvement? Be specific — reference the domain, the business process, and the actual pain point being addressed.

### Who Is Involved and What They Want
Describe each user role or actor who interacts with this feature. For each: who are they (their job, their goals, their technical skill level)? What do they want to achieve with this feature? What does "success" look like from their perspective — what do they see, what is saved, what changes in the system?

### Step-by-Step: What Happens When the Feature Is Used
Write a numbered walkthrough of the entire user flow, from start to finish. For EACH step, you MUST cover all four of these angles:
1. **User perspective**: What does the user see or do? (specific UI element, input, click, navigation)
2. **Frontend behavior**: What does the browser/app do in response? (validation check, loading spinner, state update, API call triggered)
3. **Backend/system behavior**: What happens on the server? (business rule applied, database read/write, external service called, calculation performed)
4. **Final outcome**: What is the new state? (what the user now sees, what record was created/updated, what confirmation is shown)

This walkthrough must be specific enough that a tester can follow it exactly and verify each step independently.

### Worked Examples
Provide 2–3 short, concrete worked examples using realistic, plausible data from this domain. Each example must follow this format:
- **Scenario**: Describe a specific real-world situation (user role, data state, action being taken) using realistic values — not "User A" or "value X"
- **Steps**: What the user does, step by step
- **Expected outcome**: What the user sees on screen, what is saved, what confirmation appears

These examples are the most useful part for a tester on day one. They must be specific enough that the tester could replicate them exactly in a test environment.

### Technical Details for Testing (written for testers, not developers)
This is the most important section for test planning. Explain the technical aspects in terms testers need to understand:
- **What data is stored and where**: which records are created or updated, what fields change, what the before-state and after-state look like
- **What API calls happen**: explain HTTP verbs (GET = read data, POST = create, PUT/PATCH = update, DELETE = remove), the path/URL, and what data is sent and received — in plain terms
- **What business logic runs**: calculations, rules, thresholds, conditions — explain the formula or rule in plain English
- **Where validation happens**: client-side (instant, before sending) vs server-side (after sending, checked on the backend) — explain what each validates and what happens when it fails
- **Side effects**: what else happens as a result (emails sent, notifications triggered, other records updated, UI elsewhere updated)

If something is not described in the story, explicitly call it out as an assumption or open question rather than guessing silently.

### What Parts of the System Change
List every layer that this feature affects. For each layer, be specific:
- **UI / Frontend**: which specific screens, forms, buttons, modals, dropdowns, or tables are added or changed
- **API / Backend**: which endpoints are new, which are modified, what the new request/response looks like
- **Database**: which tables/collections gain new rows, new columns, or new constraints
- **Permissions**: which user roles can now do something they couldn't before; what access checks are added
- **Third-party integrations**: external services, payment gateways, email providers, analytics, audit logs

### Where Else This Could Break (Affected Areas)
List specific parts of the application that could be indirectly affected by this change — things the tester should also check even though they are not the main focus of the story. Name specific pages, API routes, components, or features by name.

---

## DESK CHECK SECTION GUIDE

Every scenario below must be story-specific. Do not write generic scenarios that could apply to any feature.

CRITICAL FORMATTING RULE: Every bullet becomes a standalone checklist item. Use a vertical 3-line format: bold scenario name on the first line, specific conditions on the second (indented 2 spaces), and the outcome on the third line starting with → (indented 2 spaces). Bold the key result in the outcome line.

IMPORTANT: The ### Section Name headings (e.g. ### Happy Path Scenarios, ### Negative / Error Scenarios, ### Edge Cases) MUST appear verbatim in the deskCheck.content markdown — they create separate tabs in the checklist UI. Do not omit them.

Format to use:
- **[Scenario name — concise and specific]**
  [conditions — key: value pairs, e.g. status: Disbursed, prolongable: False, maxTermMonths: 36]
  → **[key outcome]** — [supporting detail: fields changed, error message, HTTP status, UI state]

### Happy Path Scenarios
Write 4–6 happy path scenarios using the format above. Name each scenario after its specific case. Use realistic domain values. Never write a generic scenario.

### Negative / Error Scenarios
Write 4–6 failure scenarios using the same format. Bold the failure outcome. Include HTTP status code, error message text, and UI behaviour in the detail.

### Edge Cases
Write 4–6 edge case scenarios. Name the scenario after the boundary or unusual condition. Be explicit in the bolded outcome — "accepted and stored" or "rejected with..." — never vague.

### Permission and Access Control Scenarios
Only include if the story involves roles or permissions. One bullet per access rule:
- **[Role] attempts [action]**
  [conditions — role, resource state, request]
  → **[what happens]** — [403 returned / redirect / button hidden / action blocked]

### API and Backend Behaviour
One bullet per API contract point. Cover request shape, response shape, and error codes:
- **[HTTP METHOD /endpoint — scenario]**
  [request body / params with specific values]
  → **[response status]** — [key response fields + side-effects, e.g. DB write, event published]

---

## TEST SUGGESTIONS SECTION GUIDE

Same CRITICAL FORMATTING RULE: every bullet uses the same vertical 3-line format with a bold scenario name and a → outcome line.

### Unit Tests
Write 4–6 unit test cases:
- **[functionName — scenario]**
  [input: specific values, e.g. principal: £20,000, termMonths: 36, rate: 5.9%]
  → **[key return value or thrown error]** — [supporting detail, e.g. 36 instalments each = £609.58, total = £21,944.88]

### Integration Tests
Write 4–5 integration test cases:
- **[HTTP METHOD /endpoint — scenario]**
  [request body with specific values]
  → **[response status]** — [key response fields + resulting DB state]

### What to Automate vs What to Test Manually
Write bullets with bold prefixes — no sub-headings:
- **Automate:** [specific flow] — [reason: deterministic, high regression risk, runs in CI, etc.]
- **Manual:** [specific case] — [reason: visual, exploratory, accessibility, etc.]

---

## AMBIGUITIES ITEMS GUIDE

Each item must be ONE specific, concrete gap in the story — not a generic statement. Examples of good ambiguity items:
- "The story mentions 'validating the amount' but does not define the minimum or maximum allowed value. The tester cannot write a boundary test without this."
- "It is unclear whether the 'Submit' button should be disabled while the API call is in progress, or whether double-submits should be handled server-side. Neither is specified."

Aim for 6–10 items. Minimum 3.

## ASSUMPTIONS ITEMS GUIDE

Each item must state what you assumed AND why — traceable to something in the story. Examples:
- "Assumed the email field uses standard HTML5 email format validation (RFC 5322) because the story says 'validate email' without specifying the exact rules."
- "Assumed only users with the 'Admin' role can access this feature because the story says 'admin functionality' without listing specific roles."

Minimum 3 items.

## OPEN QUESTIONS ITEMS GUIDE

Each question must be directed at a specific role (BA, PO, Dev, or DevOps) and be actionable. Examples:
- "[BA/PO] What is the maximum allowed value for the 'amount' field? The story does not define an upper limit, which prevents writing boundary tests."
- "[Dev] Is there a server-side duplicate check when this form is submitted, or is the frontend expected to prevent duplicates before calling the API?"
- "[Dev] Will there be a database migration for this change? If so, is it backward-compatible (can the old version of the code still run against the migrated DB)?"

Minimum 5 items.

## GENERATED TITLE GUIDE

Produce a concise, descriptive 4-8 word title capturing the core action and subject. Include the user role or feature name. Do NOT use generic titles like "User Story Analysis". Good examples: "Admin bulk-export user reports CSV", "Checkout payment validation flow", "Patient appointment self-booking workflow".`;

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

const PROMPT_VERSION = "v2";

function generateSmartTitle(story: string): string {
  const text = story.trim();
  // Pattern 1: "As a(n) [role], I want to [action]" — extract the action
  const asAMatch = text.match(/as\s+an?\s+[\w\s]{1,30},?\s+i\s+(?:want|need|can)\s+to\s+([^,.;([\n]+)/i);
  if (asAMatch) {
    const action = asAMatch[1].trim();
    const jiraMatch = text.match(/\b([A-Z]{2,10}-\d+)\b/);
    const words = action.split(/\s+/).slice(0, 6).join(" ");
    return (jiraMatch ? `${jiraMatch[1]}: ` : "") + words + (action.split(/\s+/).length > 6 ? "…" : "");
  }
  // Pattern 2: JIRA ID + first non-trivial line
  const jiraMatch = text.match(/\b([A-Z]{2,10}-\d+)\b/);
  // Pattern 3: First line if it looks like a title (short, no trailing period)
  const firstLine = text.split(/\n/)[0].trim();
  if (firstLine.length > 0 && firstLine.length <= 80 && !/[.!?]$/.test(firstLine)) {
    const title = firstLine.slice(0, 60) + (firstLine.length > 60 ? "…" : "");
    return jiraMatch && !firstLine.includes(jiraMatch[1]) ? `${jiraMatch[1]}: ${title}` : title;
  }
  // Pattern 4: First 7 words
  const allWords = text.split(/\s+/);
  const title = allWords.slice(0, 7).join(" ") + (allWords.length > 7 ? "…" : "");
  return jiraMatch && !title.includes(jiraMatch[1]) ? `${jiraMatch[1]}: ${allWords.slice(0, 5).join(" ")}…` : title;
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
${firstSentence}. This story describes functionality related to: ${keyPhrases.slice(0, 4).join(", ") || "requirements that need clarification"}. A detailed review of the full story text is needed to produce a complete explanation — the sections below reflect what could be derived automatically.

## Business Purpose
Based on the text, the core business domain involves: **${keyPhrases.slice(0, 3).join(" / ") || "unclear — story lacks sufficient business context"}**. The following key concepts appear in the story: ${phraseList}. Without an LLM, a full business rationale cannot be inferred — please add an OpenAI API key or provide more story context.

## Main User Goal
The main user goal derived from the text: _"${firstSentence}"_

## System Changes
${hasUI ? "- **UI changes** detected (buttons, forms, pages, modals mentioned) — confirm exact screens/components affected.\n" : ""}${hasAPI ? "- **API/endpoint changes** detected — confirm which endpoints are new vs modified.\n" : ""}${hasDB ? "- **Data/persistence changes** detected — confirm whether new tables/columns are added or existing ones modified.\n" : ""}${hasAuth ? "- **Auth/permission changes** detected — confirm which roles are affected and whether any new permissions are introduced.\n" : ""}${!hasUI && !hasAPI && !hasDB && !hasAuth ? "- No specific system layers clearly identified in the text. Clarify with the developer which layers are affected.\n" : ""}

## Affected Areas
${hasUI ? "- Frontend / UI layer\n" : ""}${hasAPI ? "- API / Backend services\n" : ""}${hasDB ? "- Database / Data persistence\n" : ""}${hasAuth ? "- Authentication / Authorization\n" : ""}- Services or modules referencing: ${keyPhrases.slice(0, 5).join(", ") || "_(not specified)_"}`;

  const deskCheck = `## Happy Path Scenarios
${sentences.slice(0, 3).map((s, i) => `${i + 1}. Given the system is in a valid state, when the user performs the described action ("${s}"), then the expected outcome should be confirmed.`).join("\n")}
${sentences.length === 0 ? "1. _(Story text is too short to derive specific happy path scenarios — please provide a more detailed story)_" : ""}

> **Note:** Add an OpenAI API key to get story-specific scenarios instead of these auto-generated ones.

## Negative Scenarios
- **Missing required fields:** Submit the main action form with each required field left blank — verify a specific, descriptive validation error is shown and the action is blocked.${hasAPI ? "\n- **API failure:** Simulate a 500 or 503 response from the backend — verify the UI shows a user-friendly error and does not crash or show raw error details." : ""}${hasAPI ? "\n- **4xx errors:** Simulate 400 (bad request) and 404 (not found) responses — verify the correct error message is displayed per case." : ""}${hasAuth ? "\n- **Unauthorized access:** Attempt the action with a role that should not have access — verify a 403 is returned and the UI blocks or redirects appropriately." : ""}
- **Network interruption:** Disconnect the network mid-request — verify the UI handles the timeout gracefully and does not leave data in a partial/corrupted state.
- **Session expiry:** Allow the session to expire mid-flow — verify the user is redirected to login and the attempted action is not silently lost.

## Edge Cases
- **Empty inputs:** Submit text fields with only whitespace — verify this is treated as empty and rejected.
- **Very long inputs:** Enter the maximum character limit (and one character over) in text fields — verify truncation, rejection, or error message.
- **Special characters:** Use \`<script>\`, SQL injection strings, and unicode in text inputs — verify they are sanitized and do not cause errors.
- **Duplicate submission:** Submit the same action twice in rapid succession (e.g. double-click) — verify only one operation is executed.
- **Concurrent users:** Two users perform the same action on the same record simultaneously — verify no data corruption or race condition occurs.
- **Browser refresh mid-flow:** Refresh the browser during a multi-step flow — verify the user either resumes correctly or is shown a clear state.${hasUI ? "\n- **Mobile / small screen:** Verify all UI elements are accessible and functional on small viewports (≤ 375px width)." : ""}
- **Stale data:** Open the feature, have another user modify the underlying data, then submit — verify the system handles conflicts without silent failure.

## Validation Scenarios
- Identified key domain terms requiring validation: **${keyPhrases.slice(0, 4).join(", ") || "_(not specified — confirm with developer)_"}**
- For each required field: confirm which fields are mandatory and what the exact error message is when left empty.
- For date/time fields: test past dates, future dates, invalid formats (e.g. 31/02), and timezone edge cases.
- For numeric fields: test zero, negative values, decimal values, and values exceeding business-defined limits.
- For text fields: test minimum length, maximum length, and format constraints (if any).
- For dropdowns/selects: test with no selection made, with a pre-selected default, and with an invalid value sent directly via API.${hasDB ? "\n- **Database constraints:** Verify that unique constraints, not-null constraints, and foreign key constraints are enforced — test what happens when they are violated." : ""}

## Permission / Access Cases${hasAuth ? `
- **Authorized user:** Verify that the user role intended for this feature can access and complete the action successfully.
- **Unauthorized role:** Verify that a lower-privilege role (e.g. read-only, guest) cannot access the feature — button is hidden or action returns 403.
- **Admin override:** If admins have elevated access, verify they can perform the action in all states.
- **Direct URL access:** Try accessing the feature page/endpoint directly via URL without the correct role — verify redirect or 403.
- **Token expiry:** Let the auth token expire mid-flow — verify the user is not able to complete the action and is prompted to re-authenticate.
- **Token tampering:** Send a modified or forged token — verify the request is rejected with 401.` : `
- _(Auth/permission signals not detected in story text — confirm with the developer if role-based access applies to this feature)_`}

## Data-Related Scenarios${hasDB ? `
- **Pre-condition:** Verify what data must exist before the action can be performed. Test what happens when this pre-existing data is missing.
- **Successful save:** After the action completes, query the database directly and verify the saved record matches what was submitted.
- **Data update:** Perform the action twice to update an existing record — verify old values are replaced and not duplicated.
- **Data deletion side effects:** If this action deletes or modifies related records, verify cascading behavior is correct and no orphaned data remains.
- **Large dataset:** Test the feature when the dataset contains thousands of records — verify no performance degradation or timeout.
- **Empty dataset:** Test the feature when there are zero existing records — verify the UI handles this state gracefully (empty state, no errors).` : `
- _(Data persistence not clearly detected in story text — confirm with the developer whether this feature reads/writes to a database)_`}

## UI / API / Backend Behavior${hasUI ? `
- Verify a loading spinner or skeleton is shown while async data is being fetched or submitted.
- Verify success feedback (toast, message, redirect) is shown after the action completes.
- Verify error messages are shown inline or as a notification and are human-readable (not raw error codes).
- Verify the layout is correct and no elements overlap on desktop (1280px+), tablet (768px), and mobile (375px).` : ""}${hasAPI ? `
- Verify the correct HTTP method is used (GET/POST/PUT/PATCH/DELETE) for each endpoint.
- Verify HTTP 200/201 is returned on success; 400 on validation failure; 401 on missing auth; 403 on forbidden; 404 on not found; 500 on server error.
- Verify the request payload shape matches the agreed API contract (no extra fields, no missing required fields).
- Verify the response payload shape matches the contract and all fields are present and correctly typed.
- Verify the API rejects malformed JSON with a 400 and a descriptive error message.` : ""}
${!hasUI && !hasAPI ? "- _(System layer not clearly detected — confirm with the developer which layers (UI, API, database) are involved in this story)_" : ""}

## Dark Mode Testing${hasUI ? `
- Verify all text in the feature (labels, headings, descriptions, error messages) is readable with sufficient contrast in dark mode.
- Verify form inputs, dropdowns, date pickers, and checkboxes are styled correctly in dark mode (borders, backgrounds, text visible).
- Verify validation error messages and inline warnings are clearly visible in dark mode (red/orange should not disappear against dark backgrounds).
- Verify success states (green checkmarks, confirmation banners) are visible in dark mode.
- Verify table rows, hover states, and selected/active row highlighting work correctly in dark mode.
- Verify modal overlays and dialog backgrounds have correct dark mode styling and content is readable.
- Verify disabled buttons and form elements are visually distinguishable from enabled ones in dark mode.
- Verify the complete happy path flow can be performed end-to-end with OS/browser dark mode enabled.
- Verify no flash of light-mode styling occurs when navigating between steps of the flow in dark mode.` : `
- _(No UI signals detected in story text — confirm with the developer if there is a UI for this feature, then add dark mode test cases)_`}

## Questions to Discuss with Developer / Product Owner
- What are the exact acceptance criteria for this story — are they written in Given/When/Then format anywhere?
- Which user roles are allowed to perform this action and which are explicitly blocked?
- Are there any performance requirements (response time SLAs, concurrent user limits)?
- Which environments must be tested (dev, staging, UAT, prod)?
- Are there any feature flags, A/B tests, or phased rollout strategies for this feature?
- Are there any background jobs, queues, or async processes involved that need separate testing?
- What is the expected behavior if a dependency (external API, service) is unavailable?
- Are there any known limitations or intentional exclusions from this story's scope?

## What Should Be Confirmed Before Testing
- [ ] The feature is fully deployed to the test environment and is accessible.
- [ ] Test data is available and documented (what data is needed, in what state, and how to create it).
- [ ] All relevant API endpoints are documented or a Postman collection / Swagger spec is available.
- [ ] Any required API mocks or test doubles are in place.${hasUI ? "\n- [ ] Design/wireframes have been reviewed and approved — confirm the implementation matches." : ""}
- [ ] Regression test suite for affected areas has been identified and is ready to run.
- [ ] The developer has confirmed which areas of the code changed (to scope regression risk).
- [ ] Any dependent stories or features that must be complete first have been verified.`;

  const testSuggestions = `## Unit Tests
${hasUI ? `- **Component rendering:** Test that each UI component related to this feature renders without errors given valid props, empty props, and edge-case props.
- **Form validation logic:** Test every validation rule in isolation — required fields, format constraints, length limits. Confirm the exact error message returned for each failure case.
- **State transitions:** Test that the component correctly transitions between idle → loading → success and idle → loading → error states.
` : ""}${hasAPI ? `- **Service layer:** Test each service function with mocked HTTP responses — success (200/201), validation error (400), unauthorized (401/403), not found (404), and server error (500).
- **Input sanitization:** Test that input sanitization functions strip or reject malicious input (XSS, SQL injection strings) before they reach the API.
- **Request builder:** Test that the function building the API request payload produces the correct shape for all combinations of inputs.
` : ""}${hasDB ? `- **Repository / data-access:** Test each database query function using an in-memory or test database — verify correct SQL/ORM behavior for create, read, update, delete.
- **Data mapping:** Test that data transformation functions (entity → DTO, DTO → entity) produce correct output for all field combinations, including null/undefined values.
` : ""}- **Domain logic:** Test any business rules, calculations, or conditional logic specific to the key concepts in this story: ${keyPhrases.slice(0, 4).join(", ") || "_(key domain modules not identified — confirm with developer)_"}.
- **Error paths:** For every public function introduced, write at least one test for the error/exception path — verify errors are thrown or returned correctly and not silently swallowed.

## Integration Tests
${hasAPI && hasDB ? `- **Full round-trip:** Test the complete flow — HTTP request → service layer → database write → database read → HTTP response. Verify the response matches the expected shape and the database contains the expected record.
- **Contract compliance:** Test that the API response shape (field names, types, nesting) exactly matches the agreed contract for both success and error responses.
` : ""}${hasAuth ? `- **Authenticated flow:** Run the full happy path with a valid authenticated session — verify the action succeeds.
- **Unauthenticated flow:** Run the same flow without auth credentials — verify 401 is returned at the API level.
- **Role-based access control:** Test with each relevant role (authorized and unauthorized) — verify access is granted or denied correctly at the integration level, not just the UI level.
` : ""}${hasUI && hasAPI ? `- **UI → API integration:** Test that the UI component correctly triggers the API call, handles the response, and renders the result — use a real or stubbed API server rather than purely mocked fetch calls.
` : ""}- **Cross-module regression:** Run the existing integration test suite for any modules touched by this story — verify no regressions were introduced in shared components, services, or utilities.

## Automation vs Manual QA
**Automate (high ROI):**
- The core happy path flow for this feature (repeatable and deterministic).
- All negative/validation scenarios that can be triggered via API or form inputs.
- Role/permission checks (can be scripted against the API directly).
- Regression suite for all modules affected by this story: ${keyPhrases.slice(0, 3).join(", ") || "_(confirm affected modules with developer)_"}.${hasAuth ? "\n- Auth token expiry and unauthorized access (deterministic, fast)." : ""}

**Manual (exploratory/visual):**
- Exploratory testing of the full user flow to catch unexpected UX issues not covered by scripted tests.${hasUI ? "\n- Visual verification of layout, spacing, color, and typography — especially in dark mode.\n- Responsiveness and usability on real mobile devices (not just browser DevTools)." : ""}
- Accessibility review (keyboard navigation, screen reader compatibility, focus management).
- Usability review: are error messages clear enough for a non-technical user? Is the flow intuitive?

## Developer Discussion Points
- Which specific new functions, classes, services, or endpoints are introduced by this story? Confirm unit tests exist or will be written for each.
- Are any existing shared utilities, helpers, or services modified? If so, identify the regression risk and confirm existing tests still pass.
- What is the mocking strategy for external dependencies in tests?${hasAPI ? " (HTTP calls: use MSW, nock, or similar)" : ""}${hasDB ? " (database: in-memory DB, transaction rollback, or test fixtures)" : ""}
- Are there database migrations as part of this story? Are they backward-compatible and reversible without data loss?
- What is the minimum acceptable test coverage for new code in this story? (Recommend ≥ 80% for new files.)
- Will the CI pipeline run the full test suite (unit + integration) on every PR? If not, which tests are excluded and why?
- What is the rollback plan if this feature causes a production incident — can it be disabled via a feature flag?`;

  return {
    explanation: { title: "Story Explanation", content: explanation },
    deskCheck: { title: "Desk Check Scenarios & Edge Cases", content: deskCheck },
    testSuggestions: { title: "Unit & Integration Test Suggestions", content: testSuggestions },
    ambiguities: {
      title: "Ambiguities & Gaps",
      items: [
        /accept|criteria|given|when|then/i.test(story)
          ? "Acceptance criteria are partially present — confirm they are complete and cover all scenarios"
          : "No acceptance criteria found in story text — must be defined before testing begins",
        /error|fail|invalid|exception/i.test(story)
          ? "Error handling is mentioned but specific error messages and recovery steps are not defined"
          : "Error handling behavior is not specified — confirm what the system should do for each failure case",
        /edge|corner|boundary|limit/i.test(story)
          ? "Edge cases are partially mentioned — confirm all boundary conditions are fully defined"
          : "No edge cases or boundary conditions are defined in the story",
        /performance|security|accessib|a11y/i.test(story)
          ? "Non-functional requirements are partially mentioned — confirm specific targets and acceptance thresholds"
          : "Non-functional requirements (performance, security, accessibility) are absent from the story",
        sentences.length < 3
          ? "Story is very short — most implementation details are missing; a more detailed story is needed before testing"
          : "Story lacks step-by-step flow description — the exact sequence of user actions and system responses is not specified",
        hasUI ? "Dark mode support for new UI elements is not addressed in the story" : "It is unclear whether this story has any UI impact — confirm with the developer",
        ...(keyPhrases.length > 0 ? [`Validation rules for key domain entities (${keyPhrases.slice(0, 3).join(", ")}) are not defined — confirm field-level constraints`] : []),
      ].filter(Boolean) as string[],
    },
    assumptions: {
      title: "Assumptions Made",
      items: [
        "The story describes a user-initiated action (not a background or scheduled process)",
        `All referenced entities (${keyPhrases.slice(0, 3).join(", ") || "domain objects"}) already exist in the system`,
        hasUI ? "New UI elements follow the existing design system and dark mode is handled automatically" : "No significant UI changes are required for this story",
        hasAuth ? "Role-based access control is already in place and only authorization checks need to be added" : "This feature is accessible to all authenticated users unless stated otherwise",
        hasDB ? "Database schema changes are backward-compatible and no destructive migrations are required" : "No database schema changes are required for this story",
        hasAPI ? "API endpoints follow the existing REST conventions and authentication patterns already in use" : "No new API endpoints are introduced by this story",
        "The story has been reviewed and approved by the product owner before development began",
        "⚠️ Add a GitHub token or OpenAI key to get AI-generated assumptions specific to your story",
      ],
    },
    openQuestions: {
      title: "Open Questions for BA / PO / Dev",
      items: [
        "[BA/PO] What are the complete, formal acceptance criteria for this story in Given/When/Then format?",
        "[BA/PO] Which user roles are permitted to perform this action, and which are explicitly blocked?",
        "[Dev] Which specific functions, endpoints, or components are being added or modified?",
        hasDB ? "[Dev] Are there database migrations? Are they backward-compatible and reversible?" : "[Dev] Does this story require any changes to data storage or retrieval logic?",
        hasUI ? "[Dev/Design] Has the design been finalized and approved? Are all dark mode variants included?" : "[Dev] Is there any UI impact from this story that is not described in the text?",
        "[Dev] What is the error handling strategy — what should the user see for each failure mode?",
        "[BA/PO] Are there any performance, security, or accessibility requirements tied to this story?",
        "[DevOps] Are there feature flags, environment-specific configurations, or deployment dependencies?",
        "⚠️ Add a GitHub token or OpenAI key to get AI-generated questions specific to your story",
      ],
    },
    meta: {
      model: "rule-based",
      duration: 0,
      isFallback: true,
      promptVersion: PROMPT_VERSION,
      generatedTitle: generateSmartTitle(story),
    },
  };
}

const ALLOWED_MODELS = new Set([
  // GitHub Models — OpenAI GPT-4
  "openai/gpt-4o", "openai/gpt-4o-mini",
  "openai/gpt-4.1", "openai/gpt-4.1-mini", "openai/gpt-4.1-nano",
  // GitHub Models — OpenAI GPT-5
  "openai/gpt-5", "openai/gpt-5-mini",
  // GitHub Models — OpenAI Reasoning
  "openai/o4-mini", "openai/o3-mini",
  "openai/o1", "openai/o1-mini", "openai/o1-preview",
  // GitHub Models — Other
  "deepseek/deepseek-r1", "deepseek/deepseek-v3-0324",
  "mistral-ai/mistral-small-2503",
  "microsoft/phi-4",
  "meta/llama-3.3-70b-instruct",
  // Direct OpenAI (legacy, backward compat)
  "gpt-4o-mini", "gpt-4o", "gpt-4.1", "gpt-4.1-mini",
]);

// Any model from a known GitHub Models provider prefix is allowed even if not in the static set above
const ALLOWED_PREFIXES = ["openai/", "anthropic/", "google/", "deepseek/", "mistral-ai/", "microsoft/", "meta/", "ai21-labs/", "cohere/", "mistral/", "xai/", "copilot/"];
// Only alphanumeric, hyphens, dots, underscores, and one forward slash allowed
const MODEL_FORMAT_RE = /^[\w.\-]+\/[\w.\-]+$|^[\w.\-]+$/;

// Reasoning models don't accept temperature — detect by set or o-model pattern
const REASONING_MODELS = new Set([
  "openai/o1", "openai/o1-mini", "openai/o1-preview",
  "openai/o3", "openai/o3-mini", "openai/o4-mini",
]);

function isAllowedModel(m: unknown): m is string {
  if (typeof m !== "string" || m.length > 120 || !MODEL_FORMAT_RE.test(m)) return false;
  return ALLOWED_MODELS.has(m) || ALLOWED_PREFIXES.some((p) => m.startsWith(p));
}

// ── SSE helpers ───────────────────────────────────────────────────────────────
const SSE_ENCODER = new TextEncoder();

function sseEvent(controller: ReadableStreamDefaultController, data: Record<string, unknown>): void {
  controller.enqueue(SSE_ENCODER.encode(`data: ${JSON.stringify(data)}\n\n`));
}

function makeSseResponse(generator: (ctrl: ReadableStreamDefaultController) => Promise<void>): Response {
  const stream = new ReadableStream({ start: generator });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const story: string = body?.story ?? "";
    const rawModel: unknown = body?.model;
    const model: string = isAllowedModel(rawModel) ? rawModel : "openai/gpt-4o-mini";
    // Optional epic context — compact block from EpicAnalyzer to prepend to the user message
    const epicContext: string | undefined = typeof body?.epicContext === "string" && body.epicContext.trim().length > 0
      ? body.epicContext.trim()
      : undefined;

    if (!story || story.trim().length === 0) {
      return NextResponse.json({ error: "Story text is required." }, { status: 400 });
    }

    // ── Quality guard: reject inputs that are too short or nonsensical ──────────
    const trimmed = story.trim();
    const wordCount = trimmed.split(/\s+/).filter(w => w.length > 0).length;
    if (trimmed.length < 30 || wordCount < 6) {
      return NextResponse.json({
        error: "The input is too short to analyze. Please paste a full Jira story description (acceptance criteria, user story text, or detailed requirements) — at minimum a few sentences.",
      }, { status: 422 });
    }
    // Detect inputs that are clearly just a Jira key or a URL with no body text
    const isJiraKeyOnly = /^[A-Z]{2,10}-\d+(\s+https?:\/\/\S+)?\s*$/.test(trimmed);
    if (isJiraKeyOnly) {
      return NextResponse.json({
        error: "It looks like you only pasted a Jira ticket key (e.g. LSINST-1232). Please include the full story text — use 'Load from Jira' to fetch the content automatically, or paste the description here.",
      }, { status: 422 });
    }

    // Build the user message — prepend epic context if available
    const userContent = epicContext
      ? `=== EPIC CONTEXT (use this to enrich your analysis) ===\n${epicContext}\n\n=== STORY TO ANALYZE ===\n${story}`
      : story;

    // ── GitHub Copilot path (default): official Copilot SDK, uses your Copilot account ──
    const openaiKey = process.env.OPENAI_API_KEY;
    const useCopilot = model.startsWith("copilot/") || (!model.startsWith("anthropic/") && !openaiKey);
    if (useCopilot) {
      const { runCopilot, resolveCopilotModel, describeCopilotError } = await import("@/lib/copilot-sdk");
      const ghToken = await getGitHubAccessToken(req);
      if (!ghToken) return NextResponse.json(NOT_SIGNED_IN, { status: 401 });
      const copilotModelId = await resolveCopilotModel(ghToken, model);
      const startTime = Date.now();
      return makeSseResponse(async (controller) => {
        try {
          const content = await runCopilot({
            token: ghToken,
            model: copilotModelId,
            system: SYSTEM_PROMPT,
            user: userContent,
            onDelta: (text) => sseEvent(controller, { type: "chunk", text }),
          });
          if (!content.trim()) throw new Error("GitHub Copilot returned an empty response. Please try again or pick another model.");
          sseEvent(controller, {
            type: "done",
            tokenUsage: { promptTokens: 0, completionTokens: 0, totalTokens: 0, model: copilotModelId },
            meta: {
              model: `copilot/${copilotModelId}`,
              duration: Date.now() - startTime,
              isFallback: false,
              promptVersion: PROMPT_VERSION,
            },
          });
        } catch (err) {
          sseEvent(controller, { type: "error", error: describeCopilotError(err) });
        } finally {
          controller.close();
        }
      });
    }

    // ── Anthropic direct path: model prefixed with "anthropic/" uses ANTHROPIC_API_KEY ──
    const isAnthropicModel = model.startsWith("anthropic/");
    if (isAnthropicModel) {
      const anthropicKey = process.env.ANTHROPIC_API_KEY;
      if (!anthropicKey) {
        return NextResponse.json(
          { error: "ANTHROPIC_API_KEY is not set. Add it to your .env.local file to use Claude models directly." },
          { status: 503 }
        );
      }

      const { default: Anthropic } = await import("@anthropic-ai/sdk");
      const anthropic = new Anthropic({ apiKey: anthropicKey });
      const anthropicModelId = model.slice("anthropic/".length);

      const startTime = Date.now();
      return makeSseResponse(async (controller) => {
        try {
          const stream = anthropic.messages.stream({
            model: anthropicModelId,
            max_tokens: 8192,
            system: SYSTEM_PROMPT,
            messages: [{ role: "user", content: userContent }],
          });

          for await (const chunk of stream) {
            if (
              chunk.type === "content_block_delta" &&
              chunk.delta.type === "text_delta" &&
              chunk.delta.text
            ) {
              sseEvent(controller, { type: "chunk", text: chunk.delta.text });
            }
          }

          const finalMsg = await stream.finalMessage();
          sseEvent(controller, {
            type: "done",
            tokenUsage: {
              promptTokens: finalMsg.usage.input_tokens,
              completionTokens: finalMsg.usage.output_tokens,
              totalTokens: finalMsg.usage.input_tokens + finalMsg.usage.output_tokens,
              model: anthropicModelId,
            },
            meta: {
              model: anthropicModelId,
              duration: Date.now() - startTime,
              isFallback: false,
              promptVersion: PROMPT_VERSION,
            },
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : "Analysis failed. Please try again.";
          sseEvent(controller, { type: "error", error: message });
        } finally {
          controller.close();
        }
      });
    }

    // ── Direct OpenAI path (only when OPENAI_API_KEY is set) ──
    if (openaiKey) {
      const { default: OpenAI } = await import("openai");

      const openai = new OpenAI({ apiKey: openaiKey });

      // Direct OpenAI API uses bare model names (no vendor prefix)
      const apiModel = model.includes("/") ? model.split("/")[1] : model;
      const isReasoning = REASONING_MODELS.has(model) || /\/o\d[\w.-]*$/i.test(model);
      const responseFormat = { response_format: { type: "json_object" as const } };

      const startTime = Date.now();

      return makeSseResponse(async (controller) => {
        try {
          const stream = await openai.chat.completions.create({
            model: apiModel,
            ...responseFormat,
            messages: [
              { role: "system", content: SYSTEM_PROMPT },
              { role: "user", content: userContent },
            ],
            stream: true,
            ...(isReasoning ? {} : { temperature: 0.3 }),
          });

          let usage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
          let received = 0;
          for await (const chunk of stream) {
            const text = chunk.choices[0]?.delta?.content ?? "";
            if (text) { received += text.length; sseEvent(controller, { type: "chunk", text }); }
            if (chunk.usage) usage = chunk.usage;
          }
          if (received === 0) {
            throw new Error("The AI provider returned an empty response. Please try again or pick another model.");
          }

          sseEvent(controller, {
            type: "done",
            tokenUsage: {
              promptTokens: usage.prompt_tokens,
              completionTokens: usage.completion_tokens,
              totalTokens: usage.total_tokens,
              model: apiModel,
            },
            meta: {
              model: apiModel,
              duration: Date.now() - startTime,
              isFallback: false,
              promptVersion: PROMPT_VERSION,
            },
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : "Analysis failed. Please try again.";
          sseEvent(controller, { type: "error", error: message });
        } finally {
          controller.close();
        }
      });
    }

    // Rule-based fallback (no API key configured)
    const fallbackAnalysis = ruleBasedAnalysis(story);
    return makeSseResponse(async (controller) => {
      sseEvent(controller, { type: "chunk", text: JSON.stringify(fallbackAnalysis) });
      sseEvent(controller, { type: "done" });
      controller.close();
    });
  } catch (err) {
    console.error("analyze error", err);
    const message = err instanceof Error ? err.message : "Analysis failed. Please try again.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
