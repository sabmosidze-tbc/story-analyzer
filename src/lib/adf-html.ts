import { parse, HTMLElement, TextNode, type Node } from "node-html-parser";

/**
 * Jira's MCP tools read and write rich text as HTML (not ADF). The app builds and parses
 * ADF, so these two functions translate between them for the node set we use.
 */
type Mark = { type: string; attrs?: Record<string, unknown> };
export type AdfNode = { type: string; text?: string; attrs?: Record<string, unknown>; marks?: Mark[]; content?: AdfNode[] };

// ── ADF → HTML ───────────────────────────────────────────────────────────────
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const MARK_TAG: Record<string, [string, string]> = {
  strong: ["<strong>", "</strong>"], em: ["<em>", "</em>"], code: ["<code>", "</code>"],
  underline: ["<u>", "</u>"], strike: ["<s>", "</s>"],
};

function textHtml(n: AdfNode): string {
  let out = esc(n.text ?? "");
  // Code can't carry other marks; a link keeps the link
  const marks = n.marks ?? [];
  const hasLink = marks.some((m) => m.type === "link");
  for (const m of marks) {
    if (m.type === "link") continue;
    if (m.type === "code" && hasLink) continue;
    const tag = MARK_TAG[m.type];
    if (tag) out = tag[0] + out + tag[1];
  }
  const link = marks.find((m) => m.type === "link");
  if (link) out = `<a href="${esc(String(link.attrs?.href ?? ""))}">${out}</a>`;
  return out;
}

const kids = (n: AdfNode) => (n.content ?? []).map(toHtml).join("");

function toHtml(n: AdfNode): string {
  switch (n.type) {
    case "doc": return kids(n);
    case "text": return textHtml(n);
    case "hardBreak": return "<br>";
    case "paragraph": return `<p>${kids(n)}</p>`;
    case "heading": { const l = Math.min(6, Math.max(1, Number(n.attrs?.level) || 3)); return `<h${l}>${kids(n)}</h${l}>`; }
    case "bulletList": return `<ul>${kids(n)}</ul>`;
    case "orderedList": return `<ol>${kids(n)}</ol>`;
    case "listItem": return `<li>${kids(n)}</li>`;
    case "blockquote": return `<blockquote>${kids(n)}</blockquote>`;
    case "rule": return "<hr>";
    case "codeBlock": {
      const lang = n.attrs?.language ? ` class="language-${esc(String(n.attrs.language))}"` : "";
      return `<pre><code${lang}>${esc((n.content ?? []).map((c) => c.text ?? "").join(""))}</code></pre>`;
    }
    case "panel": return `<div data-type="panel-${esc(String(n.attrs?.panelType ?? "info"))}">${kids(n)}</div>`;
    case "status": return `<span data-type="status" data-color="${esc(String(n.attrs?.color ?? "neutral"))}">${esc(String(n.attrs?.text ?? ""))}</span>`;
    case "mediaSingle": return `<figure data-type="media-single" data-layout="${esc(String(n.attrs?.layout ?? "center"))}">${kids(n)}</figure>`;
    case "media": {
      const a = n.attrs ?? {};
      const coll = a.collection ? ` data-collection="${esc(String(a.collection))}"` : "";
      return `<div data-type="media" data-media-type="${esc(String(a.type ?? "file"))}" data-id="${esc(String(a.id ?? ""))}"${coll}></div>`;
    }
    case "table": return `<table><tbody>${kids(n)}</tbody></table>`;
    case "tableRow": return `<tr>${kids(n)}</tr>`;
    case "tableHeader": return `<th>${kids(n)}</th>`;
    case "tableCell": return `<td>${kids(n)}</td>`;
    default: return n.content ? kids(n) : esc(n.text ?? "");
  }
}

export function adfToHtml(doc: AdfNode | null | undefined): string {
  return doc ? toHtml(doc) : "";
}

// ── HTML → ADF ───────────────────────────────────────────────────────────────
const INLINE_MARK: Record<string, string> = { strong: "strong", b: "strong", em: "em", i: "em", code: "code", u: "underline", s: "strike", del: "strike" };
const BLOCK_TAGS = new Set(["p", "h1", "h2", "h3", "h4", "h5", "h6", "ul", "ol", "li", "pre", "hr", "blockquote", "table", "thead", "tbody", "tr", "td", "th", "figure", "div", "details", "section"]);

const isEl = (n: Node): n is HTMLElement => n instanceof HTMLElement;
const tag = (n: HTMLElement) => (n.rawTagName ?? "").toLowerCase();

function inlines(nodes: Node[], marks: Mark[] = []): AdfNode[] {
  const out: AdfNode[] = [];
  for (const n of nodes) {
    if (n instanceof TextNode) {
      const text = n.text.replace(/\s+/g, " ");
      if (text) out.push(marks.length ? { type: "text", text, marks } : { type: "text", text });
      continue;
    }
    if (!isEl(n)) continue;
    const t = tag(n);
    const dt = n.getAttribute("data-type");
    if (t === "br") { out.push({ type: "hardBreak" }); continue; }
    if (dt === "status") { out.push({ type: "status", attrs: { text: n.text.trim(), color: n.getAttribute("data-color") ?? "neutral" } }); continue; }
    if (dt === "mention") { out.push({ type: "text", text: n.text, ...(marks.length ? { marks } : {}) }); continue; }
    if (t === "a") { out.push(...inlines(n.childNodes, [...marks, { type: "link", attrs: { href: n.getAttribute("href") ?? "" } }])); continue; }
    const m = INLINE_MARK[t];
    out.push(...inlines(n.childNodes, m ? [...marks, { type: m }] : marks));
  }
  // Merge neighbours with identical marks
  const merged: AdfNode[] = [];
  for (const n of out) {
    const prev = merged[merged.length - 1];
    if (prev?.type === "text" && n.type === "text" && JSON.stringify(prev.marks ?? []) === JSON.stringify(n.marks ?? [])) prev.text += n.text ?? "";
    else merged.push({ ...n });
  }
  return merged;
}

/** Inline content of one block, with the outer whitespace trimmed. */
function inlineBlock(nodes: Node[]): AdfNode[] {
  const out = inlines(nodes);
  if (out[0]?.type === "text") out[0].text = out[0].text!.replace(/^\s+/, "");
  const last = out[out.length - 1];
  if (last?.type === "text") last.text = last.text!.replace(/\s+$/, "");
  return out.filter((n) => n.type !== "text" || n.text);
}

/** Block children; loose inline content gets wrapped in a paragraph. */
function blocks(nodes: Node[]): AdfNode[] {
  const out: AdfNode[] = [];
  let run: Node[] = [];
  const flush = () => {
    const c = inlineBlock(run);
    if (c.length) out.push({ type: "paragraph", content: c });
    run = [];
  };
  for (const n of nodes) {
    if (isEl(n) && (BLOCK_TAGS.has(tag(n)) || n.getAttribute("data-type") === "media")) { flush(); out.push(...block(n)); }
    else run.push(n);
  }
  flush();
  return out;
}

function block(el: HTMLElement): AdfNode[] {
  const t = tag(el);
  const dt = el.getAttribute("data-type") ?? "";
  if (/^h[1-6]$/.test(t)) return [{ type: "heading", attrs: { level: Number(t[1]) }, content: inlineBlock(el.childNodes) }];
  if (t === "p") return [{ type: "paragraph", content: inlineBlock(el.childNodes) }];
  if (t === "hr") return [{ type: "rule" }];
  if (t === "ul" || t === "ol") {
    const items = el.childNodes.filter((c): c is HTMLElement => isEl(c) && tag(c) === "li");
    return [{ type: t === "ul" ? "bulletList" : "orderedList", content: items.map((li) => ({ type: "listItem", content: blocks(li.childNodes) })) }];
  }
  if (t === "li") return [{ type: "listItem", content: blocks(el.childNodes) }];
  if (t === "pre") {
    const code = el.querySelector("code");
    const lang = code?.getAttribute("class")?.match(/language-(\S+)/)?.[1];
    const text = (code ?? el).text;
    return [{ type: "codeBlock", ...(lang ? { attrs: { language: lang } } : {}), content: text ? [{ type: "text", text }] : [] }];
  }
  if (t === "blockquote") return [{ type: "blockquote", content: blocks(el.childNodes) }];
  if (dt.startsWith("panel-")) return [{ type: "panel", attrs: { panelType: dt.slice(6) === "custom" ? "info" : dt.slice(6) }, content: blocks(el.childNodes) }];
  if (dt === "media-single" || dt === "media-group" || t === "figure") {
    const media = el.querySelectorAll('[data-type="media"]').map(mediaNode);
    return media.length ? [{ type: "mediaSingle", attrs: { layout: el.getAttribute("data-layout") ?? "center" }, content: [media[0]] }, ...media.slice(1).map((m) => ({ type: "mediaSingle", attrs: { layout: "center" }, content: [m] }))] : [];
  }
  if (dt === "media") return [{ type: "mediaSingle", attrs: { layout: "center" }, content: [mediaNode(el)] }];
  if (t === "table") {
    const rows = el.querySelectorAll("tr");
    return [{
      type: "table",
      content: rows.map((r) => ({
        type: "tableRow",
        content: r.childNodes.filter((c): c is HTMLElement => isEl(c) && (tag(c) === "td" || tag(c) === "th"))
          .map((c) => ({ type: tag(c) === "th" ? "tableHeader" : "tableCell", content: blocks(c.childNodes) })),
      })),
    }];
  }
  // div / section / details / anything else: unwrap
  return blocks(el.childNodes);
}

function mediaNode(el: HTMLElement): AdfNode {
  return { type: "media", attrs: { type: el.getAttribute("data-media-type") ?? "file", id: el.getAttribute("data-id") ?? "", collection: el.getAttribute("data-collection") ?? "" } };
}

export function htmlToAdf(html: string | null | undefined): AdfNode | null {
  if (!html?.trim()) return null;
  return { type: "doc", version: 1, content: blocks(parse(html, { blockTextElements: { script: true, style: true } }).childNodes) } as AdfNode;
}
