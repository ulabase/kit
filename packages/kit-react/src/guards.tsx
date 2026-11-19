import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from './context.js';

export interface GuardProps {
  children: ReactNode;
  /** Rendered while the initial session check is in flight. Defaults to `null`. */
  fallback?: ReactNode;
}

/**
 * Wraps a protected route. Renders `children` when authenticated, otherwise
 * redirects to `/auth/login`. While the initial session check is still running
 * it renders `fallback` (default `null`) rather than redirecting, so a reload
 * on a protected page doesn't flash the login screen.
 *
 * ```tsx
 * <Route element={<AuthGuard><Shell /></AuthGuard>}>
 *   <Route path="/app" element={<Dashboard />} />
 * </Route>
 * ```
 */
export function AuthGuard({ children, fallback = null }: GuardProps): ReactNode {
  const { isAuthenticated, initializing } = useAuth();
  if (initializing) return fallback;
  if (!isAuthenticated) return <Navigate to="/auth/login" replace />;
  return children;
}

/**
 * Wraps a public-only route (login, signup). Redirects an already-authenticated
 * user into the app (`/`); otherwise renders `children`.
 *
 * The invitation page must stay outside both guards, on both of its paths:
 * `/auth/activate` (where the service's invitation email links a new user) and
 * `/invitations/accept` (an existing one). It has to work for signed-out
 * invitees, signed-in users, and people without an account.
 */
export function PublicGuard({ children, fallback = null }: GuardProps): ReactNode {
  const { isAuthenticated, initializing } = useAuth();
  if (initializing) return fallback;
  if (isAuthenticated) return <Navigate to="/" replace />;
  return children;
}
