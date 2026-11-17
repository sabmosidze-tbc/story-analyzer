import { NextRequest, NextResponse } from "next/server";
import { getGitHubAccessToken, NOT_SIGNED_IN } from "@/lib/github-session";
import { EpicStory } from "@/types";

const EPIC_SYSTEM_PROMPT = `You are a senior QA lead preparing to test a Jira epic. You receive the epic and all its child issues (key, type, status, description).
Produce a test-oriented understanding of the WHOLE epic: how stories fit together, what must be tested across stories, and what is unclear.

Return ONLY one JSON object (no markdown fences, no prose) with exactly these keys:
{
  "goal": "2-3 sentences: what the epic delivers and the business end state",
  "scope": ["capability delivered by the epic", "..."],
  "outOfScope": ["only if stated or clearly implied; else []"],
  "businessRules": [{ "rule": "specific rule incl. limits/values", "stories": ["KEY-1"] }],
  "dataEntities": [{ "name": "table/entity/field group", "notes": "fields, states, how stories change it", "stories": ["KEY-1"] }],
  "storyNotes": [{ "key": "KEY-1", "role": "one line: what this story contributes", "dependsOn": ["KEY-2"], "risk": "high|medium|low", "riskReason": "why, one short phrase" }],
  "e2eScenarios": [{ "id": "E2E1", "title": "flow spanning stories", "stories": ["KEY-1","KEY-2"], "priority": "high|medium|low", "steps": ["concrete step"], "expected": ["observable result"] }],
  "integrationRisks": [{ "title": "short", "stories": ["KEY-1","KEY-2"], "why": "how the interaction can break", "severity": "high|medium|low" }],
  "regression": ["existing behaviour that could break and should be re-tested"],
  "questions": [{ "question": "gap/contradiction to ask the BA", "stories": ["KEY-1"] }],
  "prerequisites": ["data, config, access or service state needed before testing"],
  "contextBlock": "dense plain-text summary (max ~5000 chars) for another AI analyzing ONE story of this epic: goal, per-story one-liners with status, shared rules, data model, cross-story constraints. Lists and key:value, no filler."
}

Rules:
- storyNotes: one entry for EVERY child issue given, same keys.
- e2eScenarios: 3-8 flows that cross at least two stories; ordered by priority. Each step must be executable by a tester.
- Use only the given keys in "stories"/"dependsOn". Do not invent features, values or rules; when info is missing, add a question instead.
- Be specific (names, values, statuses from the text). No generic QA advice.`;
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

interface EpicAnalyzeBody {
  epicKey: string;
  epicSummary: string;
  epicDescription?: string;
  stories: EpicStory[];
  model?: string;
}

/** Fit all stories into ~120k chars: short descriptions stay whole, long ones share the rest. */
function buildUserMessage(epicKey: string, epicSummary: string, epicDescription: string, stories: EpicStory[]): string {
  const BUDGET = 120_000;
  const epicDesc = epicDescription.slice(0, 8000);
  // Highest per-story cap that keeps the total within budget (short descriptions stay whole).
  const room = Math.max(stories.length * 400, BUDGET - epicDesc.length);
  const lens = stories.map((s) => s.description?.trim().length ?? 0).sort((a, b) => a - b);
  let per = Infinity, used = 0;
  for (let i = 0; i < lens.length; i++) {
    const left = lens.length - i;
    if (used + lens[i] * left > room) { per = Math.floor((room - used) / left); break; }
    used += lens[i];
  }
  const lines: string[] = [`EPIC ${epicKey}: ${epicSummary}`];
  if (epicDesc) lines.push("", "Epic description:", epicDesc);
  lines.push("", `=== ${stories.length} CHILD ISSUES ===`);
  for (const s of stories) {
    lines.push("", `[${s.key}] (${s.type ?? "Story"} · ${s.status}) ${s.summary}`);
    const d = s.description?.trim();
    if (d) lines.push(d.length > per ? d.slice(0, per) + " …[truncated]" : d);
  }
  return lines.join("\n");
}
export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as EpicAnalyzeBody;
    const { epicKey, epicSummary, stories } = body;
    const epicDescription = typeof body.epicDescription === "string" ? body.epicDescription : "";
    const rawModel = body.model;
    const model: string = isAllowedModel(rawModel) ? rawModel : "openai/gpt-4o-mini";

    if (!epicKey || !stories || stories.length === 0) {
      return NextResponse.json({ error: "epicKey and stories are required." }, { status: 400 });
    }

    const userMessage = buildUserMessage(epicKey, epicSummary, epicDescription, stories);

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
            model: modelId, max_tokens: 16000, system: EPIC_SYSTEM_PROMPT,
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
