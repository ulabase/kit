/**
 * The services of the person, as `ulabase srv ls` shows them.
 */

/** A service as `GET /srvs-mgmt` lists it. */
export interface ListedService {
  _id: string;
  name?: string | null;
  /** The internal name of the plan: free, starter, pro, dedicated. */
  plan: string;
  type?: string | null;
  region?: string | null;
  tags?: string[];
  status?: string | null;
  /** The team the service is in. */
  org: { _id: string; name?: string | null };
}

/** The name of a plan as people read it in the console and on the pricing page. */
export function planLabel(plan: string): string {
  switch (plan) {
    case 'free':
      return 'Free';
    case 'starter':
      return 'Launch';
    case 'pro':
      return 'Pro';
    case 'dedicated':
      return 'Enterprise';
    default:
      return plan;
  }
}

/**
 * The values `srv new --plan` takes, and the `tier` the address of the console's wizard carries for
 * each. The same words: an address shows the name of a plan as people read it, and the wizard maps
 * `launch` to the plan's internal id.
 */
export const PLAN_TIERS: Record<string, string> = { free: 'free', launch: 'launch', pro: 'pro' };

/** By name, then by id: the order of the table and of the question `app new` asks. */
export function sortServices(services: ListedService[]): ListedService[] {
  return [...services].sort(
    (a, b) => (a.name ?? '').localeCompare(b.name ?? '') || a._id.localeCompare(b._id)
  );
}

/**
 * The table of `ulabase srv ls`: id, name, plan, region, tags, and the team when the services
 * are in more than one.
 */
export function formatServices(services: ListedService[]): string {
  const sorted = sortServices(services);
  const teams = new Set(sorted.map(s => s.org?._id)).size > 1;

  const header = ['ID', 'NAME', 'PLAN', 'REGION', 'TAGS', ...(teams ? ['TEAM'] : [])];
  const rows = sorted.map(s => [
    s._id,
    s.name ?? '',
    planLabel(s.plan) + (s.status === 'deactivated' ? ' (deactivated)' : ''),
    s.region ?? '',
    (s.tags ?? []).join(', '),
    ...(teams ? [s.org?.name ?? ''] : []),
  ]);

  const widths = header.map((h, i) => Math.max(h.length, ...rows.map(r => r[i]!.length)));
  const line = (cells: string[]) =>
    cells
      .map((c, i) => (i === cells.length - 1 ? c : c.padEnd(widths[i]!)))
      .join('  ')
      .trimEnd();

  return [line(header), ...rows.map(line)].join('\n');
}
