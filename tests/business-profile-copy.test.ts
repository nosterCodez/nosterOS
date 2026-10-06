import { afterEach, expect, test, vi } from 'vitest';
import { copyProfilePrompt } from '@/lib/business-profile/copy';
import { PROFILE_PROMPT } from '@/lib/business-profile/prompt';

afterEach(() => vi.unstubAllGlobals());
test('copies the profile prompt with the browser clipboard', async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal('navigator', { clipboard: { writeText } });
  const field = { focus: vi.fn(), select: vi.fn() }; const details = { open: false };
  expect(await copyProfilePrompt(details, field)).toBe('Prompt copied.');
  expect(writeText).toHaveBeenCalledWith(PROFILE_PROMPT);
  expect(field.select).not.toHaveBeenCalled();
});
test.each(['rejected', 'unavailable'])('selects the visible prompt when clipboard is %s', async state => {
  vi.stubGlobal('navigator', state === 'rejected' ? { clipboard: { writeText: vi.fn().mockRejectedValue(new Error('denied')) } } : {});
  const field = { focus: vi.fn(), select: vi.fn() }; const details = { open: false };
  expect(await copyProfilePrompt(details, field)).toBe("Couldn't copy automatically. Press Ctrl+C / Cmd+C");
  expect(details.open).toBe(true); expect(field.focus).toHaveBeenCalledOnce(); expect(field.select).toHaveBeenCalledOnce();
});
