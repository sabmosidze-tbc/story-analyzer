"use client";

import { cloneElement, isValidElement, useMemo, useState, type ReactElement, type ReactNode } from "react";
import { Bot, Hand, MessageCircleQuestion, PencilLine, Plus, Trash2, X } from "lucide-react";

// ── Parse the markdown the AI writes for "Test suggestions" ─────────────────

interface TestItem { name: string; detail: string; inputs: string[]; outcome: string }
type Kind = "unit" | "integration" | "automation" | "discussion" | "other";
interface Section { title: string; kind: Kind; items: TestItem[]; automate: TestItem[]; manual: TestItem[] }

const kindOf = (t: string): Kind =>
  /unit/i.test(t) ? "unit" : /integration/i.test(t) ? "integration" : /automat|manual/i.test(t) ? "automation" : /discussion|developer|question/i.test(t) ? "discussion" : "other";

function splitItem(raw: string[]): TestItem {
  const [first, ...rest] = raw;
  const m = first.match(/^\*\*(.+?)\*\*\s*:?\s*(.*)$/);
  let name = m ? m[1].replace(/:$/, "").trim() : "";
  let detail = m ? m[2].replace(/^[—–-]\s*/, "").trim() : first.trim();
  if (!name) { name = detail; detail = ""; }
  const inputs: string[] = [];
  let outcome = "";
  for (const l of rest) {
    const t = l.trim();
    if (!t) continue;
    if (/^(→|->)/.test(t)) outcome = (outcome ? outcome + " " : "") + t.replace(/^(→|->)\s*/, "");
    else if (outcome) outcome += " " + t;
    else inputs.push(t);
  }
  const inline = detail.match(/^(.*?)\s*(?:→|->)\s*(.+)$/);
  if (!outcome && inline) { detail = inline[1]; outcome = inline[2]; }
  return { name, detail, inputs, outcome };
}

export function parseTestSuggestions(md: string): Section[] {
  const sections: Section[] = [];
  let cur: Section | null = null;
  let item: string[] | null = null;
  let bucket: "automate" | "manual" | null = null;

  const flush = () => {
    if (!cur || !item) { item = null; return; }
    const it = splitItem(item);
    item = null;
    if (cur.kind === "automation") {
      const tag = it.name.match(/^(automate|manual)\b/i)?.[1].toLowerCase();
      if (tag) { (tag === "automate" ? cur.automate : cur.manual).push({ ...it, name: it.detail || it.name, detail: "" }); return; }
      if (bucket) { cur[bucket].push(it); return; }
    }
    cur.items.push(it);
  };
  const open = (title: string) => {
    flush();
    cur = { title, kind: kindOf(title), items: [], automate: [], manual: [] };
    sections.push(cur);
    bucket = null;
  };

  for (const line of md.split(/\r?\n/)) {
    const h = line.match(/^#{1,4}\s+(.+)$/);
    if (h) { open(h[1].trim()); continue; }
    const sub = line.match(/^\*\*(.+?)\*\*:?\s*$/);
    if (sub) {
      flush();
      if (!cur) open("Tests");
      if (/automat/i.test(sub[1])) bucket = "automate";
      else if (/manual/i.test(sub[1])) bucket = "manual";
      continue;
    }
    const b = line.match(/^[-*]\s+(?:\[[ x]\]\s+)?(.*)$/);
    if (b) { flush(); if (!cur) open("Tests"); item = [b[1]]; continue; }
    if (item && line.trim()) item.push(line);
  }
  flush();
  return sections.filter((s) => s.items.length || s.automate.length || s.manual.length);
}

export function serializeTestSuggestions(sections: Section[]): string {
  const item = (it: TestItem, bold: boolean) => {
    const head = bold ? `- **${it.name.replace(/\*\*/g, "")}**${it.detail ? `: ${it.detail}` : ""}` : `- ${it.name}${it.detail ? ` — ${it.detail}` : ""}`;
    const lines = [head, ...it.inputs.filter((l) => l.trim()).map((l) => `  ${l.trim()}`)];
    if (it.outcome.trim()) lines.push(`  → ${it.outcome.trim()}`);
    return lines.join("\n");
  };
  return sections.map((s) => {
    const out = [`### ${s.title}`];
    if (s.automate.length || s.manual.length) {
      if (s.automate.length) out.push("**Automate**:", ...s.automate.map((i) => item(i, false)));
      if (s.manual.length) out.push("**Manual**:", ...s.manual.map((i) => item(i, false)));
    }
    out.push(...s.items.map((i) => item(i, true)));
    return out.join("\n");
  }).join("\n\n");
}

const field = "w-full px-2.5 py-1.5 rounded-lg text-sm bg-white dark:bg-slate-900/60 border border-slate-200 dark:border-slate-600 text-slate-800 dark:text-slate-100 focus:outline-none focus:border-violet-400 resize-y";

function ItemEditor({ items, onChange, table, label }: { items: TestItem[]; onChange: (v: TestItem[]) => void; table: boolean; label?: string }) {
  const set = (i: number, patch: Partial<TestItem>) => onChange(items.map((it, n) => (n === i ? { ...it, ...patch } : it)));
  return (
    <div className="space-y-2">
      {label && <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">{label}</p>}
      {items.map((it, i) => (
        <div key={i} className="flex gap-2 items-start rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-900/30 p-2.5">
          <span className="text-xs font-semibold text-slate-400 pt-2 w-5">{i + 1}</span>
          <div className={`flex-1 grid gap-2 ${table ? "md:grid-cols-3" : ""}`}>
            <label className="block">
              {table && <span className="text-[10px] uppercase tracking-wide font-semibold text-slate-400">What to check</span>}
              <textarea rows={2} value={it.detail && !table ? `${it.name} — ${it.detail}` : it.name} onChange={(e) => set(i, { name: e.target.value, detail: table ? it.detail : "" })} className={field} />
            </label>
            {table && (
              <>
                <label className="block">
                  <span className="text-[10px] uppercase tracking-wide font-semibold text-slate-400">Example input</span>
                  <textarea rows={2} value={it.inputs.join("\n")} onChange={(e) => set(i, { inputs: e.target.value.split("\n") })} className={`${field} font-mono text-xs`} />
                </label>
                <label className="block">
                  <span className="text-[10px] uppercase tracking-wide font-semibold text-slate-400">Expected result</span>
                  <textarea rows={2} value={it.outcome} onChange={(e) => set(i, { outcome: e.target.value })} className={field} />
                </label>
              </>
            )}
          </div>
          <button onClick={() => onChange(items.filter((_, n) => n !== i))} title="Remove" className="p-1.5 mt-4 rounded-md text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10">
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      ))}
      <button onClick={() => onChange([...items, { name: "", detail: "", inputs: [], outcome: "" }])}
        className="flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg border border-dashed border-slate-300 dark:border-slate-600 text-slate-500 hover:text-violet-600 hover:border-violet-400">
        <Plus className="w-3.5 h-3.5" /> Add
      </button>
    </div>
  );
}

function StructuredEditor({ sections, onSave, onCancel }: { sections: Section[]; onSave: (md: string) => void; onCancel: () => void }) {
  const [draft, setDraft] = useState<Section[]>(() => JSON.parse(JSON.stringify(sections)));
  const upd = (i: number, patch: Partial<Section>) => setDraft((d) => d.map((s, n) => (n === i ? { ...s, ...patch } : s)));
  return (
    <div className="space-y-4">
      {draft.map((s, i) => {
        const k = KIND[s.kind];
        const buckets = s.kind === "automation" && (s.automate.length || s.manual.length);
        return (
          <section key={i} className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/60 overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-900/30">
              <h4 className="text-sm font-semibold text-slate-800 dark:text-slate-100">{k.label || s.title}</h4>
            </div>
            <div className="p-3 space-y-3">
              {buckets ? (
                <>
                  <ItemEditor label="Worth automating" items={s.automate} onChange={(v) => upd(i, { automate: v })} table={false} />
                  <ItemEditor label="Check by hand" items={s.manual} onChange={(v) => upd(i, { manual: v })} table={false} />
                </>
              ) : (
                <ItemEditor items={s.items} onChange={(v) => upd(i, { items: v })} table={s.kind === "unit" || s.kind === "integration" || s.kind === "other"} />
              )}
            </div>
          </section>
        );
      })}
      <div className="flex gap-2 justify-end">
        <button onClick={onCancel} className="text-xs px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:border-slate-400">Cancel</button>
        <button onClick={() => onSave(serializeTestSuggestions(draft.map((s) => ({ ...s, items: s.items.filter((x) => x.name.trim()), automate: s.automate.filter((x) => x.name.trim()), manual: s.manual.filter((x) => x.name.trim()) })).filter((s) => s.items.length || s.automate.length || s.manual.length)))}
          className="text-xs px-3 py-1.5 rounded-lg bg-violet-600 text-white hover:bg-violet-500">Save</button>
      </div>
    </div>
  );
}

// ── Rendering ────────────────────────────────────────────────────────────────

/** Inline **bold** and `code` only. */
function Inline({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).filter(Boolean);
  return (
    <>
      {parts.map((p, i) =>
        p.startsWith("**") ? <strong key={i} className="font-semibold text-slate-900 dark:text-white">{p.slice(2, -2)}</strong>
        : p.startsWith("`") ? <code key={i} className="font-mono text-[0.9em] px-1 rounded bg-slate-100 dark:bg-slate-700/70">{p.slice(1, -1)}</code>
        : <span key={i}>{p}</span>)}
    </>
  );
}

const KIND: Record<Kind, { label: string; hint: string }> = {
  unit:        { label: "Unit tests",          hint: "Check one piece of logic on its own, e.g. a calculation or a validation rule." },
  integration: { label: "Integration tests",   hint: "Check parts working together, e.g. an API call that saves to the database." },
  automation:  { label: "Automate or check by hand?", hint: "" },
  discussion:  { label: "Talk to the developer about", hint: "" },
  other:       { label: "",                    hint: "" },
};

function TestTable({ items }: { items: TestItem[] }) {
  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden divide-y divide-slate-200 dark:divide-slate-700">
      <div className="hidden md:grid grid-cols-[2rem_minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1.2fr)] gap-3 px-3 py-2 bg-slate-50 dark:bg-slate-900/60 text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
        <span>#</span><span>What to check</span><span>Example input</span><span>Expected result</span>
      </div>
      {items.map((it, n) => (
        <div key={n} className="grid md:grid-cols-[2rem_minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1.2fr)] gap-x-3 gap-y-1 px-3 py-2.5 text-sm">
          <span className="text-xs font-semibold text-slate-400 pt-0.5">{n + 1}</span>
          <div className="text-slate-800 dark:text-slate-100 leading-relaxed">
            <Inline text={it.name} />
            {it.detail && <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5"><Inline text={it.detail} /></p>}
          </div>
          <div className="text-slate-600 dark:text-slate-300 leading-relaxed">
            <span className="md:hidden text-[11px] font-semibold text-slate-400">Input: </span>
            {it.inputs.length ? it.inputs.map((l, i) => <p key={i} className="font-mono text-xs break-words"><Inline text={l} /></p>) : <span className="text-slate-400">—</span>}
          </div>
          <div className="text-slate-700 dark:text-slate-200 leading-relaxed">
            <span className="md:hidden text-[11px] font-semibold text-slate-400">Expected: </span>
            {it.outcome ? <Inline text={it.outcome} /> : <span className="text-slate-400">—</span>}
          </div>
        </div>
      ))}
    </div>
  );
}

function SimpleList({ title, icon, items, tone }: { title: string; icon: ReactNode; items: TestItem[]; tone: string }) {
  if (!items.length) return null;
  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-900/30 p-3.5">
      <p className={`flex items-center gap-1.5 text-sm font-semibold mb-2 pb-2 border-b border-slate-200 dark:border-slate-700 ${tone}`}>{icon} {title} <span className="ml-auto text-[10px] font-semibold px-1.5 py-px rounded-full bg-slate-100 dark:bg-slate-800 text-slate-500">{items.length}</span></p>
      {items.length ? (
        <ul className="space-y-1.5">
          {items.map((it, i) => (
            <li key={i} className="flex gap-2 text-sm text-slate-700 dark:text-slate-200 leading-relaxed">
              <span className="mt-2 w-1 h-1 rounded-full bg-slate-400 flex-shrink-0" />
              <span><Inline text={it.name} />{it.detail && <span className="text-slate-500 dark:text-slate-400"> — <Inline text={it.detail} /></span>}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export default function TestSuggestionsPanel({ content, editor, onSave }: { content: string; editor: ReactNode; onSave?: (md: string) => void }) {
  const sections = useMemo(() => parseTestSuggestions(content), [content]);
  const [editing, setEditing] = useState(false);
  const [raw, setRaw] = useState(false);

  // Unrecognised format: just show the classic card.
  if (!sections.length) return <>{editor}</>;

  return (
    <div className="space-y-5 animate-section-in">
      <div className="flex items-start gap-3 flex-wrap">
        <div className="flex-1 min-w-[16rem]">
          <p className="text-base font-semibold text-slate-800 dark:text-slate-100">Tests for the developer</p>
          <p className="text-sm text-slate-500 dark:text-slate-400">Checks the developer should cover in code. Your own manual test cases are in the <b>Scenarios</b> tab.</p>
        </div>
        <button onClick={() => { setEditing((v) => !v); setRaw(false); }}
          className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:border-violet-400">
          {editing ? <><X className="w-3.5 h-3.5" /> Close editor</> : <><PencilLine className="w-3.5 h-3.5" /> Edit</>}
        </button>
      </div>

      {editing && onSave && !raw ? (
        <div className="space-y-3">
          <StructuredEditor sections={sections} onCancel={() => setEditing(false)} onSave={(md) => { onSave(md); setEditing(false); }} />
          <button onClick={() => setRaw(true)} className="text-xs text-slate-400 hover:text-violet-500 underline">Raw text and post to Jira</button>
        </div>
      ) : editing ? (isValidElement(editor) ? cloneElement(editor as ReactElement<{ startEditing?: boolean; onEditorClose?: () => void }>, { startEditing: !!onSave ? false : true, onEditorClose: () => { setEditing(false); setRaw(false); } }) : editor) : <div className="nice-scroll max-h-[70vh] overflow-y-auto pr-2 space-y-4">{sections.map((s) => {
        const k = KIND[s.kind];
        return (
          <section key={s.title} className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/60 overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-900/30">
              <h4 className="text-sm font-semibold text-slate-800 dark:text-slate-100">{k.label || s.title}</h4>
              {k.hint && <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{k.hint}</p>}
            </div>
            <div className="p-3">
              {s.kind === "automation" && (s.automate.length || s.manual.length) ? (
                <div className={`grid gap-3 ${s.automate.length && s.manual.length ? "md:grid-cols-2" : ""}`}>
                  <SimpleList title="Worth automating" icon={<Bot className="w-4 h-4" />} items={s.automate} tone="text-teal-600 dark:text-teal-300" />
                  <SimpleList title="Check by hand" icon={<Hand className="w-4 h-4" />} items={s.manual} tone="text-orange-600 dark:text-orange-300" />
                </div>
              ) : s.kind === "discussion" || s.kind === "automation" ? (
                <SimpleList title={s.kind === "discussion" ? "Points to discuss" : s.title} icon={<MessageCircleQuestion className="w-4 h-4" />} items={s.items} tone="text-slate-600 dark:text-slate-300" />
              ) : (
                <TestTable items={s.items} />
              )}
            </div>
          </section>
        );
      })}</div>}
    </div>
  );
}