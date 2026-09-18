import { useEffect, useMemo, useState } from 'react';
import { collection, query, where } from 'firebase/firestore';
import { db } from '../firebase.js';
import { useAuth } from './useAuth.jsx';
import { useQuery } from './useFirestore.js';

const KEY = 'quizquest:classroom';

/** Teacher's classrooms plus the one currently selected (remembered per device). */
export function useClassroom() {
  const { user } = useAuth();
  const uid = user?.uid;
  const { data: classrooms, loading, error } = useQuery(() => (uid ? query(collection(db, 'classrooms'), where('teacherUid', '==', uid)) : null), [uid]);
  const [selectedId, setSelectedId] = useState(() => {
    try {
      return window.localStorage.getItem(KEY);
    } catch {
      return null;
    }
  });
  const sorted = useMemo(() => classrooms.slice().sort((a, b) => (a.name || '').localeCompare(b.name || '')), [classrooms]);
  const classroom = sorted.find((c) => c.id === selectedId) || sorted[0] || null;
  useEffect(() => {
    const onStorage = (e) => e.key === KEY && setSelectedId(e.newValue);
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);
  const select = (id) => {
    setSelectedId(id);
    try {
      window.localStorage.setItem(KEY, id);
    } catch {
      /* private mode */
    }
  };
  return { classrooms: sorted, classroom, classroomId: classroom?.id || null, select, loading, error };
}
