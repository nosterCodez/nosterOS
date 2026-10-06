import { PROFILE_PROMPT } from './prompt';

export async function copyProfilePrompt(
  details: Pick<HTMLDetailsElement, 'open'> | null,
  field: Pick<HTMLTextAreaElement, 'focus' | 'select'> | null,
): Promise<string> {
  try {
    await navigator.clipboard.writeText(PROFILE_PROMPT);
    return 'Prompt copied.';
  } catch {
    if (details) details.open = true;
    field?.focus();
    field?.select();
    return "Couldn't copy automatically. Press Ctrl+C / Cmd+C";
  }
}
