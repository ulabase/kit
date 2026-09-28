import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as kit from '@ulabase/kit';
import { AuthGuard, PublicGuard, RhAuthProvider } from '../index';

vi.mock('@ulabase/kit');

const config = { apiBaseUrl: 'https://x.restheart.com' };
const user = { _id: 'a@b.com', roles: ['user'] } as kit.UserInfo;

function tree(initial: string) {
  return (
    <RhAuthProvider config={config}>
      <MemoryRouter initialEntries={[initial]}>
        <Routes>
          <Route path="/" element={<div>HOME</div>} />
          <Route path="/app" element={<AuthGuard><div>PROTECTED</div></AuthGuard>} />
          <Route path="/auth/login" element={<PublicGuard><div>LOGIN</div></PublicGuard>} />
        </Routes>
      </MemoryRouter>
    </RhAuthProvider>
  );
}

function signedIn() {
  vi.mocked(kit.getToken).mockReturnValue('tok');
  vi.mocked(kit.checkSession).mockResolvedValue(user);
  vi.mocked(kit.getTeams).mockResolvedValue([]);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(kit.getToken).mockReturnValue(null);
});

describe('AuthGuard', () => {
  it('redirects to /auth/login when unauthenticated', async () => {
    render(tree('/app'));
    await waitFor(() => screen.getByText('LOGIN'));
    expect(screen.queryByText('PROTECTED')).toBeNull();
  });

  it('renders children when authenticated', async () => {
    signedIn();
    render(tree('/app'));
    await waitFor(() => screen.getByText('PROTECTED'));
  });
});

describe('PublicGuard', () => {
  it('redirects an authenticated user away from login', async () => {
    signedIn();
    render(tree('/auth/login'));
    await waitFor(() => screen.getByText('HOME'));
    expect(screen.queryByText('LOGIN')).toBeNull();
  });

  it('renders children when unauthenticated', async () => {
    render(tree('/auth/login'));
    await waitFor(() => screen.getByText('LOGIN'));
  });
});
