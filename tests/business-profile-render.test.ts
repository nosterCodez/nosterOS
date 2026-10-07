import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { expect, test } from 'vitest';
import { Markdown } from '@/components/Markdown';
test('profile safe mode shows scripts and link URLs as text without active content', () => {
  const html = renderToStaticMarkup(createElement(Markdown, { safe: true, text: '<script>alert(1)</script>\n\n[Site](https://example.com) ![Photo](https://example.com/a.png)' }));
  expect(html).not.toMatch(/<(script|img|a)[\s>]/);
  expect(html).toContain('&lt;script&gt;'); expect(html).toContain('https://example.com');
});
test('a heading after a list gets extra space so it does not read as part of the list', () => {
  const html = renderToStaticMarkup(createElement(Markdown, { safe: true, text: '## Services\n- Websites\n- SEO\n## Service area\nMcAllen' }));
  expect(html).toMatch(/<h3 class="[^"]*pt-1[^"]*">Services<\/h3>/);
  expect(html).toMatch(/<h3 class="[^"]*pt-3[^"]*">Service area<\/h3>/);
});
