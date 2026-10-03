export const BUSINESSES = [
  { id: 'nostermarketing', name: 'nosterMarketing' },
  { id: 'nosterhealth', name: 'nosterHealth' },
  { id: 'nosterlogistics', name: 'nosterLogistics' },
  { id: 'autopilot-store', name: 'autopilot-store' },
] as const;
export type BusinessId = (typeof BUSINESSES)[number]['id'];
export const ROLLUP_ID = 'nostercodes';
