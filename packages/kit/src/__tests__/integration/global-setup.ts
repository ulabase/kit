import { adminFetch } from './helpers';

/**
 * Global cleanup: runs once before all test suites start and after all
 * test suites finish. Removes ALL test data matching the test patterns.
 * Uses bulk DELETE with filter — single request per collection.
 */
async function cleanupAllTestData() {
  // 1. Bulk delete all test users (*@test.ulabase.dev)
  const userFilter = encodeURIComponent(JSON.stringify({ _id: { $regex: '@test\\.ulabase\\.dev$' } }));
  await adminFetch(`/users/*?filter=${userFilter}`, { method: 'DELETE' });

  // 2. Bulk delete all test teams (createdBy matching test emails)
  const teamFilter = encodeURIComponent(JSON.stringify({ '$or': [{ createdBy: { '$regex': '.*@test\\.ulabase\\.dev' } }, { createdBy: { '$regex': '.*@example\\.com' } }] }));
  await adminFetch(`/teams/*?filter=${teamFilter}`, { method: 'DELETE' });

  // 3. Bulk delete all test invitations
  const inviteFilter = encodeURIComponent(JSON.stringify({ email: { $regex: '@test\\.ulabase\\.dev$' } }));
  await adminFetch(`/auth_invitations/*?filter=${inviteFilter}`, { method: 'DELETE' });
}

/** Runs once before all test suites. */
export async function setup() {
  await cleanupAllTestData();
}

/** Runs once after all test suites. */
export async function teardown() {
  await cleanupAllTestData();
}