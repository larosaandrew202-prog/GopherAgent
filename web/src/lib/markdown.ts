/* Markdown pipeline shared by chat bubbles, memory/knowledge viewers, etc.
 *
 * Ported from console.js::createMd with the CJK-friendly emphasis patch and
 * the greedy-linkify fix, so LLM output renders the same as the vanilla app. */
import MarkdownIt from 'markdown-it';
import hljs from 'highlight.js';

// CJK ideographs, kana, Hangul and full/half-width forms (BMP only).
const CJK_CHAR_RE =
  /[\u1100-\u11FF\u2E80-\u303F\u3040-\u33FF\u3400-\u4DBF\u4E00-\u9FFF\uA960-\uA97F\uAC00-\uD7FF\uF900-\uFAFF\uFE10-\uFE19\uFE30-\uFE6F\uFF00-\uFF60\uFFE0-\uFFE6]/;

/* eslint-disable @typescript-eslint/no-explicit-any */
function patchCjkEmphasis(md: any) {
  const State = md.inline && md.inline.State;
  if (!State || !State.prototype.scanDelims || State.prototype._cjkEmphasisPatched) return;
  const utils = md.utils;
  const scanDelims = State.prototype.scanDelims;
  State.prototype.scanDelims = function (start: number, canSplitWord: boolean) {
    const res = scanDelims.call(this, start, canSplitWord);
    if (!canSplitWord) return res;
    const lastCode = start > 0 ? this.src.charCodeAt(start - 1) : 0x20;
    const nextPos = start + res.length;
    const nextCode = nextPos < this.posMax ? this.src.charCodeAt(nextPos) : 0x20;
    if (utils.isWhiteSpace(lastCode) || utils.isWhiteSpace(nextCode)) return res;
    if (
      !CJK_CHAR_RE.test(String.fromCharCode(lastCode)) &&
      !CJK_CHAR_RE.test(String.fromCharCode(nextCode))
    ) {
      return res;
    }
    res.can_open = true;
    res.can_close = true;
    return res;
  };
  State.prototype._cjkEmphasisPatched = true;
}

const md: MarkdownIt = new MarkdownIt({
  html: false,
  breaks: true,
  linkify: true,
  typographer: true,
  highlight(str: string, lang: string) {
    if (lang && hljs.getLanguage(lang)) {
      try {
        return hljs.highlight(str, { language: lang }).value;
      } catch {
        /* fall through */
      }
    }
    return hljs.highlightAuto(str).value;
  },
});

patchCjkEmphasis(md);

// Fix greedy linkify: markdown-it swallows trailing emphasis/CJK punctuation
// glued to a URL, turning the tail into a broken link.
const GREEDY_LINK_CUT = /[*\u3000-\u303F\uFF00-\uFFEF]/;
md.core.ruler.after('linkify', 'fix_greedy_linkify', (state: any) => {
  for (const blk of state.tokens) {
    if (blk.type !== 'inline' || !blk.children) continue;
    const ch = blk.children;
    for (let i = 0; i < ch.length; i++) {
      const open = ch[i];
      if (open.type !== 'link_open' || open.markup !== 'linkify') continue;
      const textTok = ch[i + 1];
      const close = ch[i + 2];
      if (!textTok || textTok.type !== 'text' || !close || close.type !== 'link_close') continue;
      const idx = textTok.content.search(GREEDY_LINK_CUT);
      if (idx < 0) continue;
      const keep = textTok.content.slice(0, idx);
      const spill = textTok.content.slice(idx);
      textTok.content = keep;
      open.attrSet('href', keep);
      const spillTok = new state.Token('text', '', 0);
      spillTok.content = spill;
      ch.splice(i + 3, 0, spillTok);
    }
  }
});

const defaultLinkOpen =
  md.renderer.rules.link_open ||
  ((tokens: any, idx: number, options: any, _env: any, self: any) =>
    self.renderToken(tokens, idx, options));

md.renderer.rules.link_open = (tokens: any, idx: number, options: any, env: any, self: any) => {
  const token = tokens[idx];
  token.attrPush(['target', '_blank']);
  token.attrPush(['rel', 'noopener noreferrer']);
  return defaultLinkOpen(tokens, idx, options, env, self);
};

export function renderMarkdown(text: string): string {
  return md.render(text || '');
}

export function escapeHtml(str: unknown): string {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
