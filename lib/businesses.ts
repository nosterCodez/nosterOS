export const BUSINESSES = [
  { id: 'workspace', name: 'This workspace' },
  { id: 'nostermarketing', name: 'nosterMarketing' },
  { id: 'nosterhealth', name: 'nosterHealth' },
  { id: 'autopilot-store', name: 'autopilot-store' },
] as const;
export type BusinessId = (typeof BUSINESSES)[number]['id'];
export const ROLLUP_ID = 'nostercodes';
