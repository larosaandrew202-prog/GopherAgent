import { useEffect, useMemo, useRef } from 'react';
import { renderMarkdown } from '@/lib/markdown';
import { backendUrl } from '@/api/client';
import { classNames } from '@/lib/format';

/** Renders markdown and enhances each code block with a language label and
 *  copy button (matching console.js::_addCodeBlockHeaders). */
export function Markdown({ content, className = '' }: { content: string; className?: string }) {
  const html = useMemo(() => renderMarkdown(content), [content]);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    // Rewrite image URLs so they resolve against the backend even when the
    // console is served from a different origin (dev), and so that bare
    // workspace-relative paths emitted by the model still render.
    root.querySelectorAll('img').forEach((img) => {
      const src = img.getAttribute('src') ?? '';
      if (!src || /^(https?:|data:|blob:)/i.test(src)) return;
      if (src.startsWith('/api/')) {
        img.setAttribute('src', backendUrl(src));
        return;
      }
      if (/\.(png|jpe?g|gif|webp|bmp|svg)(\?.*)?$/i.test(src)) {
        const rel = src.replace(/^\.?\/*/, '');
        img.setAttribute('src', backendUrl(`/api/media?path=${encodeURIComponent(rel)}`));
      }
    });
    root.querySelectorAll('pre').forEach((pre) => {
      if (pre.parentElement?.classList.contains('code-block-wrapper')) return;
      const codeEl = pre.querySelector('code');
      if (!codeEl) return;
      const langClass = Array.from(codeEl.classList).find((c) => c.startsWith('language-'));
      const language = langClass ? langClass.replace('language-', '') : '';
      const showLang = language && language !== 'undefined' && language !== 'code';
      const wrapper = document.createElement('div');
      wrapper.className = 'code-block-wrapper';
      const header = document.createElement('div');
      header.className = 'code-block-header';
      const langSpan = document.createElement('span');
      langSpan.className = 'code-block-lang';
      langSpan.textContent = showLang ? language.charAt(0).toUpperCase() + language.slice(1) : '';
      const btn = document.createElement('button');
      btn.className = 'code-copy-btn';
      btn.title = 'Copy code';
      btn.innerHTML =
        '<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>';
      btn.addEventListener('click', () => {
        void navigator.clipboard.writeText(codeEl.textContent ?? '');
      });
      header.appendChild(langSpan);
      header.appendChild(btn);
      pre.parentNode?.insertBefore(wrapper, pre);
      wrapper.appendChild(header);
      wrapper.appendChild(pre);
    });
  }, [html]);

  return (
    <div
      ref={ref}
      className={classNames('msg-content', className)}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
