import { vi } from 'vitest';

// Existing route unit tests exercise business logic with an authorized caller.
// Security suites explicitly unmock this module and exercise the real boundary.
vi.mock('@/lib/session', () => ({ apiSessionError: vi.fn(async () => null) }));
