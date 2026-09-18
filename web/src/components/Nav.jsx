import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth.jsx';

export default function Nav() {
  const { user, profile, signOut } = useAuth();
  const navigate = useNavigate();

  const handleSignOut = async () => {
    await signOut();
    navigate('/');
  };

  return (
    <nav className="nav">
      <div className="nav-brand">
        <Link to="/">Quiz Bowl</Link>
      </div>
      <div className="nav-links">
        <Link to="/practice">Practice</Link>
        <Link to="/classroom">Classroom</Link>
        {user ? (
          <>
            <span className="nav-user">{profile?.displayName ?? user.email ?? 'Guest'}</span>
            <button className="btn-ghost" onClick={handleSignOut}>Sign out</button>
          </>
        ) : (
          <Link to="/login" className="btn btn-primary">Sign in</Link>
        )}
      </div>
    </nav>
  );
}
