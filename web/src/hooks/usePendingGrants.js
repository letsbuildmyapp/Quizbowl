import { collection, query, where } from 'firebase/firestore';
import { db } from '../firebase.js';
import { useAuth } from './useAuth.jsx';
import { useQuery } from './useFirestore.js';

/** Grants the student hasn't revealed yet (the Vault). Survives skips and disconnects. */
export function usePendingGrants() {
  const { claims } = useAuth();
  const sid = claims.studentId;
  const { data, loading } = useQuery(() => (sid ? query(collection(db, `students/${sid}/grants`), where('acknowledgedAt', '==', null)) : null), [sid]);
  return { pending: data.slice().sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0)), loading };
}
