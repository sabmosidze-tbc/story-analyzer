import { NextRequest, NextResponse } from "next/server";
import { getGitHubAccessToken, NOT_SIGNED_IN } from "@/lib/github-session";
import {
  computeCoverage, demoteFakeTransitions, dropUngroundedTables, modelItems, normalizeModel, normalizeScenarios,
  type Scenario, type TestDesign,
} from "@/lib/test-design";

const DESIGN_PROMPT = `You are a senior QA test designer. Derive test scenarios from a user story using formal black-box test design techniques.

GROUNDING (most important): every condition, value, status, error code and result you use MUST come from the story text. Never use general domain knowledge (e.g. buckets, schedules, fees) unless the story itself mentions it. If unsure whether something is in the story, leave it out or record it as a gap.

Work in two steps and return ONE raw JSON object (no markdown fences).

STEP 1 — Build the test model. Use ONLY the techniques that fit the story:
- EP (Equivalence Partitioning): for every input/condition, list valid and invalid classes. Each class gets a representative "value" that a tester would type/select.
- BVA (Boundary Value Analysis): ONLY for ranges/limits explicitly stated in the story (amounts, counts, dates, lengths, percentages). For each range give below-min, min, max, above-max using the smallest meaningful step (e.g. 0.01 for money/percent, 1 for integers/days). If the limit is named but not given as a number (e.g. "MinimumRate of the product scheme"), use the name in "value" (e.g. "MinimumRate - 0.01").
- DT (Decision Table): when 2+ conditions from the story combine to decide the result (typically the acceptance criteria: validation, status, version, range…).
  • Conditions are short questions about the request/entity, written so a tester understands them (e.g. "Loan status allowed?", "Rate within Min–Max?"). Use Y/N or a small set of story values.
  • When the story lists several rejection rules, model them as a precedence chain: one rule per rejection reason (that check fails, earlier checks pass, later checks "-"), plus one rule where everything passes. Assume the order the story lists them unless it says otherwise, and mention the assumption.
  • Actions are the observable results named in the story (e.g. "Reject 422 INVALID_INTEREST_RATE", "Register operation, return referenceId").
  • Rules must be COMPLETE and MUTUALLY EXCLUSIVE.
  • "source": copy, word for word, the story sentence(s) the table is built from.
  • "reasoning": ONE plain sentence a non-expert understands.
  • Each rule's "why": one short plain sentence, quoting the story where possible.
- ST (State Transition): ONLY when the feature itself MOVES an entity from one state to another (e.g. Draft → Submitted, Active → Closed), or the story lists allowed/forbidden status changes. If a status is only an eligibility check (the action is allowed in some statuses and blocked in others, and the status stays the same), that is EP on the status — NOT ST. Every allowed transition must change the state; for blocked ones, "to" is the state the user tried to reach.
List every technique you considered but did not use in "notUsed" with a one-sentence reason.
If the story mentions a rule but not the concrete value, DO NOT invent a value — record it as a gap.

GAPS — think like a senior tester preparing for a refinement meeting:
- Only include gaps that block or weaken a specific test (an unknown value, error code, message, precedence, permission, or behaviour). No generic gaps (performance, security, UI) unless the story makes them relevant.
- Each gap: "topic" (3-6 words), "detail" (what exactly is missing, referencing the story), "impact" (which test or check this blocks, or the risk if guessed wrong), "question" (the exact question to ask the BA/PO), "assumption" (what the scenarios assume until it is answered, or "" if none).
- Order by impact, most important first. Maximum 6.

STEP 2 — Write scenarios that cover EVERY model item.
- Each scenario lists the model ids it covers in "covers".
- A scenario may cover several VALID items, but at most ONE invalid (rejected) EP/BVA item — never combine invalid values.
- The scenario's test data MUST literally contain the value of each EP/BVA item it covers, and mention the from-state for ST items.
- "outcome" is "rejected" if any covered item is rejected, otherwise "accepted".
- Keep text short and concrete. Use realistic domain values.

JSON shape:
{
  "techniques": [{ "technique": "EP|BVA|DT|ST", "reason": "why this technique fits this story (1 sentence)" }],
  "partitions": [{ "id": "EP1", "variable": "Order status", "label": "Open order (allowed)", "value": "Open", "outcome": "accepted|rejected" }],
  "boundaries": [{ "id": "BV1", "variable": "Quantity", "value": "101", "unit": "", "position": "below-min|min|max|above-max", "outcome": "accepted|rejected" }],
  "decisionTables": [{ "id": "DT1", "title": "short title", "source": "exact story sentence(s)", "conditions": ["..."], "actions": ["..."], "reasoning": "...",
                       "rules": [{ "id": "DT1-R1", "when": ["Y","N"], "then": ["X",""], "outcome": "accepted|rejected", "why": "..." }] }],
  "transitions": [{ "id": "ST1", "from": "Draft", "event": "submit", "to": "Submitted", "outcome": "accepted|rejected" }],
  "notUsed": [{ "technique": "EP|BVA|DT|ST", "reason": "why it does not fit this story" }],
  "scenarios": [{ "title": "...", "technique": "EP|BVA|DT|ST", "covers": ["EP1","BV2"], "preconditions": "...",
                  "steps": ["..."], "data": { "field": "value" }, "expected": "observable result", "outcome": "accepted|rejected",
                  "priority": "high|medium|low" }],
  "gaps": [{ "topic": "...", "detail": "...", "impact": "...", "question": "...", "assumption": "..." }]
}
Use empty arrays for techniques that do not apply.`;

const REPAIR_PROMPT = `You are a senior QA test designer. Some items of an existing test model are not covered by any valid scenario.
Write NEW scenarios that cover exactly the listed items, following these rules:
- "covers" lists the item ids.
- At most ONE rejected EP/BVA item per scenario.
- Test data MUST literally contain each covered EP/BVA value; mention the from-state for ST items.
- "outcome" is "rejected" if any covered item is rejected, otherwise "accepted".
Return ONE raw JSON object: { "scenarios": [ { "title", "technique", "covers", "preconditions", "steps", "data", "expected", "outcome", "priority" } ] }`;

function parseJson(raw: string): Record<string, unknown> {
  const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  return JSON.parse(start >= 0 && end > start ? cleaned.slice(start, end + 1) : cleaned);
}

type Caller = (system: string, user: string) => Promise<string>;

async function buildCaller(req: NextRequest, model: string): Promise<Caller | NextResponse> {
  const openaiKey = process.env.OPENAI_API_KEY;
  if (model.startsWith("copilot/") || (!model.startsWith("anthropic/") && !openaiKey)) {
    const { runCopilot, resolveCopilotModel } = await import("@/lib/copilot-sdk");
    const token = await getGitHubAccessToken(req);
    if (!token) return NextResponse.json(NOT_SIGNED_IN, { status: 401 });
    const resolved = await resolveCopilotModel(token, model);
    return (system, user) => runCopilot({ token, model: resolved, system, user });
  }
  if (model.startsWith("anthropic/")) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return NextResponse.json({ error: "Anthropic not configured." }, { status: 503 });
    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    const client = new Anthropic({ apiKey });
    return async (system, user) => {
      const msg = await client.messages.create({
        model: model.slice("anthropic/".length), max_tokens: 8192, system,
        messages: [{ role: "user", content: user }],
      });
      return msg.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join("");
    };
  }
  const { default: OpenAI } = await import("openai");
  const openai = new OpenAI({ apiKey: openaiKey });
  const id = model.includes("/") ? model.slice(model.indexOf("/") + 1) : model;
  return async (system, user) => {
    const c = await openai.chat.completions.create({
      model: id, temperature: 0.2,
      messages: [{ role: "system", content: system }, { role: "user", content: user }],
    });
    return c.choices[0]?.message?.content ?? "";
  };
}

export async function POST(req: NextRequest) {
  let body: { story?: string; model?: string; epicContext?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid request." }, { status: 400 }); }

  const story = body.story?.trim();
  if (!story) return NextResponse.json({ error: "Story text is required." }, { status: 400 });
  const model = body.model?.trim() || "copilot/default";
  // Epic context is deliberately NOT sent: scenarios must test only what this story says.
  const userContent = story;

  try {
    const call = await buildCaller(req, model);
    if (call instanceof NextResponse) return call;

    // AI: build the model and the scenarios
    const first = parseJson(await call(DESIGN_PROMPT, userContent));
    const demoted = demoteFakeTransitions(dropUngroundedTables(normalizeModel(first), story), normalizeScenarios(first.scenarios));
    const design = demoted.design;
    const known = new Set(modelItems(design).map((i) => i.id));
    let scenarios: Scenario[] = demoted.scenarios.filter((s) => s.covers.length === 0 || s.covers.some((c) => known.has(c)));
    let coverage = computeCoverage({ ...design, scenarios });

    // Code found gaps → one automatic gap-fill round
    let repaired = 0;
    if (coverage.uncovered.length > 0) {
      const items = modelItems(design).filter((i) => coverage.uncovered.includes(i.id));
      const repairInput = `=== STORY ===\n${story}\n\n=== UNCOVERED MODEL ITEMS ===\n${items
        .map((i) => `${i.id} [${i.technique}] ${i.label}${i.value ? ` (value: ${i.value})` : ""} → ${i.outcome}`)
        .join("\n")}`;
      try {
        const extra = normalizeScenarios(parseJson(await call(REPAIR_PROMPT, repairInput)).scenarios, scenarios.length + 1);
        if (extra.length) {
          scenarios = [...scenarios, ...extra];
          coverage = computeCoverage({ ...design, scenarios });
          repaired = extra.length;
        }
      } catch (err) {
        console.warn("[analyze/scenarios] gap-fill round failed:", err);
      }
    }

    const result: TestDesign = {
      ...design,
      scenarios,
      coverage: { ...coverage, repaired },
      model,
      generatedAt: new Date().toISOString(),
    };
    return NextResponse.json({ testDesign: result });
  } catch (err) {
    console.error("[analyze/scenarios] error:", err);
    const { describeCopilotError } = await import("@/lib/copilot-sdk");
    const message = err instanceof SyntaxError ? "The AI returned an invalid test design. Try again." : describeCopilotError(err);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
