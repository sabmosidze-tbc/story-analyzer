import { NextRequest, NextResponse } from "next/server";
import { getGitHubAccessToken, NOT_SIGNED_IN } from "@/lib/github-session";
import { EpicStory } from "@/types";

const EPIC_SYSTEM_PROMPT = `You are a senior QA engineer synthesizing a rich context document about a Jira epic and all its child stories. This will be injected into individual story analysis prompts so the AI has full cross-story awareness.

Your output must be a JSON object with exactly this structure:
{
  "contextBlock": "rich, detailed context block — see instructions below"
}

For "contextBlock" — write a detailed, structured block optimized for AI consumption. This is the ONLY output. There is no separate human document. Make it as rich as possible — up to 6000 characters. Include:

EPIC GOAL (2-3 sentences): What this epic is building, the business goal, end state.

STORIES ALREADY BUILT (one paragraph each):
- Story key + title + status
- What it implemented (specific features, logic, APIs, UI)
- Which database tables/fields it touched and what changed
- Business rules or validations it introduced
- Any known constraints, edge cases, or gotchas documented in the story

STORIES IN PROGRESS (one paragraph each, same format as above)

STORIES NOT YET STARTED (one line each: key + title + what it will likely do based on the epic)

DATA MODELS & ENTITIES:
For every table/entity touched across the epic:
- Table name, key fields, field types if known
- Relationships (foreign keys, 1:N, etc.)
- What state the data is in before and after the epic is complete

CROSS-STORY BUSINESS RULES & CONSTRAINTS:
List every business rule, validation, or architectural constraint that applies to more than one story. Be specific — name the rule, what it checks, and what happens when violated.

CROSS-STORY INTEGRATION RISKS & EDGE CASES:
Scenarios where two or more stories interact and could cause bugs. Race conditions, ordering dependencies, shared state, data consistency risks.

TEST ENVIRONMENT PREREQUISITES:
Specific data, configuration, permissions, and service state needed before testing any story in this epic.

Be dense. Use abbreviations. Prefer lists and key:value format over prose. Every sentence must be testable or actionable — no filler.`;


interface EpicAnalyzeBody {
  epicKey: string;
  epicSummary: string;
  stories: EpicStory[];
  model?: string;
}

const ALLOWED_PREFIXES = ["openai/", "anthropic/", "google/", "deepseek/", "mistral-ai/", "microsoft/", "meta/", "ai21-labs/", "cohere/", "mistral/", "xai/", "copilot/"];
const MODEL_FORMAT_RE = /^[\w.\-]+\/[\w.\-]+$|^[\w.\-]+$/;

function isAllowedModel(m: unknown): m is string {
  if (typeof m !== "string" || m.length > 120 || !MODEL_FORMAT_RE.test(m)) return false;
  return ALLOWED_PREFIXES.some((p) => m.startsWith(p));
}

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

function buildUserMessage(epicKey: string, epicSummary: string, stories: EpicStory[]): string {
  const lines: string[] = [
    `Epic: ${epicKey} — "${epicSummary}"`,
    `Total child stories: ${stories.length}`,
    "",
    "=== CHILD STORIES ===",
    "",
  ];

  for (const s of stories) {
    lines.push(`[${s.key}] (${s.status}) ${s.summary}`);
    if (s.description && s.description !== "(no description)") {
      // Include full description — this is the deep analysis pass
      lines.push(s.description.slice(0, 1500)); // cap at 1500 chars per story
    }
    lines.push("");
  }

  return lines.join("\n");
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as EpicAnalyzeBody;
    const { epicKey, epicSummary, stories } = body;
    const rawModel = body.model;
    const model: string = isAllowedModel(rawModel) ? rawModel : "openai/gpt-4o-mini";

    if (!epicKey || !stories || stories.length === 0) {
      return NextResponse.json({ error: "epicKey and stories are required." }, { status: 400 });
    }

    const userMessage = buildUserMessage(epicKey, epicSummary, stories);

    // ── GitHub Copilot path (default): official Copilot SDK ──────────────────
    const openaiKey = process.env.OPENAI_API_KEY;
    if (model.startsWith("copilot/") || (!model.startsWith("anthropic/") && !openaiKey)) {
      const { runCopilot, resolveCopilotModel, describeCopilotError } = await import("@/lib/copilot-sdk");
      const ghToken = await getGitHubAccessToken(req);
      if (!ghToken) return NextResponse.json(NOT_SIGNED_IN, { status: 401 });
      const modelId = await resolveCopilotModel(ghToken, model);
      return makeSseResponse(async (ctrl) => {
        try {
          const content = await runCopilot({
            token: ghToken,
            model: modelId,
            system: EPIC_SYSTEM_PROMPT,
            user: userMessage,
            onDelta: (text) => sseEvent(ctrl, { type: "chunk", text }),
          });
          if (!content.trim()) throw new Error("GitHub Copilot returned an empty response. Please try again or pick another model.");
          sseEvent(ctrl, { type: "done" });
        } catch (err) {
          sseEvent(ctrl, { type: "error", error: describeCopilotError(err) });
        } finally { ctrl.close(); }
      });
    }

    // ── Anthropic direct path ─────────────────────────────────────────────────
    if (model.startsWith("anthropic/")) {
      const anthropicKey = process.env.ANTHROPIC_API_KEY;
      if (!anthropicKey) return NextResponse.json({ error: "ANTHROPIC_API_KEY not set." }, { status: 503 });
      const { default: Anthropic } = await import("@anthropic-ai/sdk");
      const anthropic = new Anthropic({ apiKey: anthropicKey });
      const modelId = model.slice("anthropic/".length);
      return makeSseResponse(async (ctrl) => {
        try {
          const stream = anthropic.messages.stream({
            model: modelId, max_tokens: 8192, system: EPIC_SYSTEM_PROMPT,
            messages: [{ role: "user", content: userMessage }],
          });
          for await (const chunk of stream) {
            if (chunk.type === "content_block_delta" && chunk.delta.type === "text_delta" && chunk.delta.text) {
              sseEvent(ctrl, { type: "chunk", text: chunk.delta.text });
            }
          }
          sseEvent(ctrl, { type: "done" });
        } catch (err) {
          sseEvent(ctrl, { type: "error", error: err instanceof Error ? err.message : "Analysis failed" });
        } finally { ctrl.close(); }
      });
    }

    // ── Direct OpenAI path (only when OPENAI_API_KEY is set) ──────────────────
    const { default: OpenAI } = await import("openai");
    const openai = new OpenAI({ apiKey: openaiKey });
    const resolvedModel = model.startsWith("openai/") ? model.slice("openai/".length) : model;

    const isReasoning = /\/o\d[\w.-]*$/.test(resolvedModel) || /^o\d[\w.-]*$/.test(resolvedModel);

    return makeSseResponse(async (ctrl) => {
      try {
        const stream = await openai.chat.completions.create({
          model: resolvedModel, stream: true,
          ...(isReasoning ? {} : { temperature: 0.2 }),
          messages: [{ role: "system", content: EPIC_SYSTEM_PROMPT }, { role: "user", content: userMessage }],
        });
        let received = 0;
        for await (const chunk of stream) {
          const text = chunk.choices[0]?.delta?.content ?? "";
          if (text) { received += text.length; sseEvent(ctrl, { type: "chunk", text }); }
        }
        if (received === 0) {
          throw new Error("The AI provider returned an empty response. Please try again or pick another model.");
        }
        sseEvent(ctrl, { type: "done" });
      } catch (err) {
        sseEvent(ctrl, { type: "error", error: err instanceof Error ? err.message : "Epic analysis failed" });
      } finally { ctrl.close(); }
    });

  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
}
