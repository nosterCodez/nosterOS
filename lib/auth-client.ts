'use client';
import { createAuthClient } from 'better-auth/react';
import { magicLinkClient, organizationClient } from 'better-auth/client/plugins';
import { ac, roles } from '@/lib/auth-access';

export const authClient = createAuthClient({ plugins: [magicLinkClient(), organizationClient({ ac, roles })] });
