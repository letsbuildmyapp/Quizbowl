import { useEffect } from 'react';
import { Link, NavLink, Navigate, Outlet, useLocation } from 'react-router-dom';
import { LogOut } from 'lucide-react';
import { useAuth, homeFor } from '../hooks/useAuth.jsx';
import { Loading } from './ui.jsx';

export function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'auto' });
  }, [pathname]);
  return null;
}

export function Brand({ to = '/' }) {
  return (
    <Link to={to} className="brand" aria-label="QuizQuest home">
      <img src="/art/owl.png" alt="" width="36" height="36" />
      QUIZQUEST
    </Link>
  );
}

/**
 * Role-aware layout. nav: [{ to, label, icon: LucideIcon, end? }]
 * bottom: show a phone bottom bar (student + parent); otherwise the top nav scrolls.
 */
export function AppShell({ nav, bottom = false, home = '/', right }) {
  const auth = useAuth();
  return (
    <div className="shell">
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <header className="topbar">
        <Brand to={home} />
        <nav className={`topnav ${bottom ? 'has-bottom' : ''}`} aria-label="Main">
          {nav.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => (isActive ? 'active' : undefined)}>
              {n.icon ? <n.icon size={18} aria-hidden /> : null}
              {n.label}
            </NavLink>
          ))}
        </nav>
        <div className="topbar-right">
          {right}
          <button type="button" className="btn btn-ghost btn-sm" onClick={auth.signOut}>
            <LogOut size={16} aria-hidden />
            <span>Sign out</span>
          </button>
        </div>
      </header>
      <main id="main" tabIndex={-1}>
        <Outlet />
      </main>
      {bottom ? (
        <nav className="bottomnav" aria-label="Main">
          {nav.slice(0, 5).map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => (isActive ? 'active' : undefined)}>
              {n.icon ? <n.icon size={22} aria-hidden /> : null}
              {n.short || n.label}
            </NavLink>
          ))}
        </nav>
      ) : null}
    </div>
  );
}

/** Gate a route tree by role. allow: (auth) => boolean */
export function RequireRole({ allow, children }) {
  const auth = useAuth();
  const location = useLocation();
  if (auth.loading) return <Loading full />;
  if (!auth.user) return <Navigate to={`/login?next=${encodeURIComponent(location.pathname)}`} replace />;
  if (!allow(auth)) return <Navigate to={homeFor(auth)} replace />;
  return children;
}
