import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { expect, test } from 'vitest';
import { Markdown } from '@/components/Markdown';
test('profile safe mode shows scripts and link URLs as text without active content', () => {
  const html = renderToStaticMarkup(createElement(Markdown, { safe: true, text: '<script>alert(1)</script>\n\n[Site](https://example.com) ![Photo](https://example.com/a.png)' }));
  expect(html).not.toMatch(/<(script|img|a)[\s>]/);
  expect(html).toContain('&lt;script&gt;'); expect(html).toContain('https://example.com');
});
