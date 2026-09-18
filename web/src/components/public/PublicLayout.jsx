import { Link } from 'react-router-dom';
import { Brand } from '../AppShell.jsx';
import { homeFor } from '../../hooks/useAuth.jsx';
import '../../pages/public/public.css';

/** Only allow same-site paths like "/play/worlds" as redirect targets. */
export function safeNext(value) {
  if (!value || typeof value !== 'string') return null;
  if (!value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) return null;
  return value;
}

/** homeFor() for claims we just refreshed (before the auth context catches up). */
export function homeForClaims(claims, user) {
  const c = claims || {};
  return homeFor({
    user,
    role: c.role || null,
    isStudent: c.role === 'student',
    isTeacher: c.role === 'teacher',
    isParent: c.role === 'parent',
    isContentAdmin: !!c.contentAdmin,
    isPlatformAdmin: !!c.platformAdmin
  });
}

export function Owl({ size = 96, className = '' }) {
  return <img src="/art/owl.png" alt="" width={size} height={Math.round(size * (380 / 420))} className={`pub-owl ${className}`} aria-hidden="true" />;
}

export function PublicHeader({ dark = false }) {
  return (
    <header className={`pub-header ${dark ? 'pub-header-dark' : ''}`}>
      <Brand />
      <nav className="pub-header-links" aria-label="Site">
        <Link to="/privacy" className="pub-header-link hide-sm">
          Privacy
        </Link>
        <Link to="/login" className="btn btn-sm pub-header-signin">
          Sign in
        </Link>
      </nav>
    </header>
  );
}

export function PublicFooter() {
  return (
    <footer className="pub-footer">
      <div className="pub-footer-inner">
        <div className="row" style={{ gap: 12 }}>
          <Owl size={44} />
          <div className="stack" style={{ gap: 2 }}>
            <strong className="pub-footer-brand">QUIZQUEST</strong>
            <span className="caption">A passion project by Meridian</span>
          </div>
        </div>
        <nav className="pub-footer-links" aria-label="Footer">
          <Link to="/login">Sign in</Link>
          <Link to="/pilot">Request a pilot</Link>
          <Link to="/privacy">Privacy</Link>
        </nav>
      </div>
    </footer>
  );
}

/** Standard public page frame: header, main landmark, footer. */
export function PublicPage({ children, narrow = false, footer = true }) {
  return (
    <div className="pub-shell">
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <PublicHeader />
      <main id="main" tabIndex={-1} className={`page ${narrow ? 'page-narrow' : ''} pub-main`}>
        {children}
      </main>
      {footer ? <PublicFooter /> : null}
    </div>
  );
}
