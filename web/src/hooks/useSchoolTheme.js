import { useAuth } from './useAuth.jsx';
import { useDoc } from './useFirestore.js';
import { resolveTheme } from '../lib/rewards.js';

/** The student's (or teacher's) school theme from schoolThemes/{schoolId}; default theme otherwise. */
export function useSchoolTheme() {
  const { claims } = useAuth();
  const { data, loading } = useDoc(claims.schoolId ? `schoolThemes/${claims.schoolId}` : null);
  return { theme: resolveTheme(data || null), schoolName: data?.schoolName || null, rewardCatalog: data?.rewardCatalog || null, loading };
}
