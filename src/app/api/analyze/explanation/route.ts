import { NextRequest, NextResponse } from "next/server";
import { getGitHubAccessToken, NOT_SIGNED_IN } from "@/lib/github-session";

const EXPLANATION_PROMPT = `You are a senior QA engineer writing for a QA tester audience. Your task is to rewrite ONLY the "Story Explanation" section of an existing analysis for a Jira story. The tester wants a fresh, clearer explanation.

Your output must be rich, specific, and written so that a brand-new tester on day one can understand the feature completely. Follow every sub-section below exactly.

Return a JSON object with this exact structure:
{
  "explanation": {
    "title": "Story Explanation",
    "content": "markdown content here"
  }
}

---

## EXPLANATION SECTION GUIDE

Write the explanation so a brand-new tester on day one can read it and fully understand what this feature is, why it exists, and how it works. Every section below is mandatory.

### Simple Explanation
Write 4–6 sentences in plain, conversational English. What does this feature do? Imagine explaining it to a smart person who has never heard of this system. Describe the state of the world BEFORE this feature exists, and what changes AFTER. Avoid all technical jargon — if you must use a term, explain it inline.

### Worked Examples
Provide 2–3 short, concrete worked examples using realistic, plausible data from this domain. Each example must follow this format:
- **Scenario**: Describe a specific real-world situation (user role, data state, action being taken) using realistic values — not "User A" or "value X"
- **Steps**: What the user does, step by step
- **Expected outcome**: What the user sees on screen, what is saved, what confirmation appears

These examples are the most useful part for a tester on day one. They must be specific enough that the tester could replicate them exactly in a test environment.

### Business Purpose
Why does this feature need to exist? What problem does it solve for the business or the user? What would go wrong, or what would the user be unable to do, if this feature did not exist? Be specific — reference the domain and the actual pain point.

### Who Is Involved and What They Want
Describe each user role or actor who interacts with this feature. For each: who are they, what do they want to achieve, and what does success look like from their perspective?

### Step-by-Step: What Happens When the Feature Is Used
Write a numbered walkthrough of the entire user flow, from start to finish. For EACH step cover: user perspective, frontend behavior, backend/system behavior, and the final outcome.

### Technical Details for Testing (written for testers, not developers)
Cover: what data is stored and where, what API calls happen (in plain terms), what business logic runs, where validation happens, and any side effects.

### What Parts of the System Change
List every layer this feature affects: UI/Frontend, API/Backend, Database, Permissions, and any third-party integrations.

### Where Else This Could Break (Affected Areas)
List specific pages, API routes, components, or features that could be indirectly affected.
`;

function isAllowedModel(m: unknown): m is string {
  return typeof m === "string" && m.trim().length > 0;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const story: string = body?.story ?? "";
    const rawModel: unknown = body?.model;
    const model: string = isAllowedModel(rawModel) ? rawModel : "openai/gpt-4o-mini";
    const epicContext: string | undefined =
      typeof body?.epicContext === "string" && body.epicContext.trim().length > 0
        ? body.epicContext.trim()
        : undefined;

    if (!story || story.trim().length === 0) {
      return NextResponse.json({ error: "Story text is required." }, { status: 400 });
    }

    const userContent = epicContext
      ? `=== EPIC CONTEXT ===\n${epicContext}\n\n=== STORY ===\n${story}`
      : story;

    // ── GitHub Copilot path (default): official Copilot SDK ──────────────────
    const openaiKey = process.env.OPENAI_API_KEY;
    if (model.startsWith("copilot/") || (!model.startsWith("anthropic/") && !openaiKey)) {
      const { runCopilot, resolveCopilotModel, describeCopilotError } = await import("@/lib/copilot-sdk");
      const ghToken = await getGitHubAccessToken(req);
      if (!ghToken) return NextResponse.json(NOT_SIGNED_IN, { status: 401 });
      try {
        const raw = await runCopilot({
          token: ghToken,
          model: await resolveCopilotModel(ghToken, model),
          system: EXPLANATION_PROMPT,
          user: userContent,
        });
        return parseAndRespond(raw);
      } catch (err) {
        return NextResponse.json({ error: describeCopilotError(err) }, { status: 502 });
      }
    }

    // ── Anthropic path ────────────────────────────────────────────────────────
    const isAnthropicModel = model.startsWith("anthropic/");
    if (isAnthropicModel) {
      const apiKey = process.env.ANTHROPIC_API_KEY;
      if (!apiKey) return NextResponse.json({ error: "Anthropic not configured." }, { status: 503 });

      const { default: Anthropic } = await import("@anthropic-ai/sdk");
      const client  = new Anthropic({ apiKey });
      const modelId = model.slice("anthropic/".length);

      const message = await client.messages.create({
        model: modelId,
        max_tokens: 4096,
        system: EXPLANATION_PROMPT,
        messages: [{ role: "user", content: userContent }],
      });

      const raw = message.content.filter(b => b.type === "text").map(b => (b as { type: "text"; text: string }).text).join("");
      return parseAndRespond(raw);
    }

    // ── Direct OpenAI path (only when OPENAI_API_KEY is set) ──────────────────
    const resolvedModel = model.includes("/") ? model.slice(model.indexOf("/") + 1) : model;
    const { default: OpenAI } = await import("openai");
    const openai = new OpenAI({ apiKey: openaiKey });

    const completion = await openai.chat.completions.create({
      model: resolvedModel,
      messages: [
        { role: "system", content: EXPLANATION_PROMPT },
        { role: "user",   content: userContent },
      ],
      temperature: 0.4,
    });

    const raw = completion.choices[0]?.message?.content ?? "";
    return parseAndRespond(raw);

  } catch (err) {
    console.error("[analyze/explanation] error:", err);
    return NextResponse.json({ error: "Failed to regenerate explanation." }, { status: 500 });
  }
}

function parseAndRespond(raw: string): NextResponse {
  // Strip markdown code fences if present
  const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim();
  try {
    const parsed = JSON.parse(cleaned) as { explanation?: { title?: string; content?: string } };
    if (!parsed?.explanation?.content) {
      return NextResponse.json({ error: "AI returned unexpected format." }, { status: 502 });
    }
    return NextResponse.json({ explanation: parsed.explanation });
  } catch {
    return NextResponse.json({ error: "Failed to parse AI response." }, { status: 502 });
  }
}
