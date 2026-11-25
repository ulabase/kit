import { describe, expect, it } from 'vitest';
import { formatServices, planLabel, PLAN_TIERS, type ListedService } from '../../services.js';

const team = { _id: 't1', name: 'Acme' };

const shop: ListedService = { _id: 'c0ffee', name: 'shop', plan: 'free', region: 'eu-central-1', tags: ['prod', 'web'], org: team };
const live: ListedService = { _id: '2000c9', name: 'shop-live', plan: 'starter', region: 'eu-central-1', tags: [], org: team };

describe('planLabel', () => {
  it('shows the plans with the names people read', () => {
    expect(planLabel('free')).toBe('Free');
    expect(planLabel('starter')).toBe('Launch');
    expect(planLabel('pro')).toBe('Pro');
    expect(planLabel('dedicated')).toBe('Enterprise');
  });

  it('maps --plan launch to the tier the wizard reads', () => {
    expect(PLAN_TIERS['launch']).toBe('starter');
    expect(PLAN_TIERS['starter']).toBeUndefined();
  });
});

describe('formatServices', () => {
  it('prints id, name, plan, region and tags, sorted by name', () => {
    expect(formatServices([live, shop])).toBe(
      [
        'ID      NAME       PLAN    REGION        TAGS',
        'c0ffee  shop       Free    eu-central-1  prod, web',
        '2000c9  shop-live  Launch  eu-central-1',
      ].join('\n')
    );
  });

  it('adds the team when the services are in more than one', () => {
    const other: ListedService = { ...live, org: { _id: 't2', name: 'Side project' } };
    const table = formatServices([shop, other]);
    expect(table.split('\n')[0]).toMatch(/TEAM$/);
    expect(table).toContain('Side project');
  });

  it('says when a service is deactivated', () => {
    expect(formatServices([{ ...shop, status: 'deactivated' }])).toContain('Free (deactivated)');
  });
});
