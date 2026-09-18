import { ButtonLink } from '../../components/ui.jsx';
import { Owl, PublicPage } from '../../components/public/PublicLayout.jsx';

export default function NotFound() {
  return (
    <PublicPage narrow>
      <div className="auth-wrap stack-lg" style={{ alignItems: 'center', textAlign: 'center', paddingTop: 24 }}>
        <Owl size={160} />
        <span className="eyebrow">Page not found</span>
        <h1>This path isn’t on the map.</h1>
        <p className="muted">The link might be old, or the page moved.</p>
        <ButtonLink to="/" variant="primary" size="lg">
          Go home
        </ButtonLink>
      </div>
    </PublicPage>
  );
}
