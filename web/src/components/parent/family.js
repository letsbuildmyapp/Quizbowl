// Shared data helpers for the family (parent) area.
// Reads: guardianLinks (parentUid == uid, status == 'active'), students/{id},
//        sessionSummaries (studentId == id, completedAt in [start, end)).
import { useEffect, useMemo, useState } from 'react';
import { collection, doc, orderBy, query, where } from 'firebase/firestore';
import { listen } from '../../lib/listen.js';
import { db } from '../../firebase.js';
import { useQuery } from '../../hooks/useFirestore.js';

/** Monday 00:00 local time of the week containing ms. */
export function startOfWeek(ms = Date.now()) {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  const dow = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - dow);
  return d.getTime();
}

/** offset 0 = this week, 1 = last week, ... */
export function weekRange(offset = 0) {
  const thisStart = startOfWeek();
  const start = new Date(thisStart);
  start.setDate(start.getDate() - offset * 7);
  const end = new Date(start);
  end.setDate(end.getDate() + 7);
  return { start: start.getTime(), end: end.getTime() };
}

export function weekLabel(offset) {
  if (offset === 0) return 'This week';
  if (offset === 1) return 'Last week';
  const { start } = weekRange(offset);
  return `Week of ${new Date(start).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
}

/** Linked children for a parent, with live student docs. */
export function useFamily(uid) {
  const links = useQuery(
    () => (uid ? query(collection(db, 'guardianLinks'), where('parentUid', '==', uid), where('status', '==', 'active')) : null),
    [uid]
  );
  const idKey = [...new Set(links.data.map((l) => l.studentId).filter(Boolean))].sort().join(',');
  const [students, setStudents] = useState({});

  useEffect(() => {
    const ids = idKey ? idKey.split(',') : [];
    const unsubs = ids.map((id) =>
      listen(
        doc(db, 'students', id),
        (snap) => setStudents((prev) => ({ ...prev, [id]: snap.exists() ? { id, ...snap.data() } : { id, missing: true } })),
        (error) => setStudents((prev) => ({ ...prev, [id]: { id, error } }))
      )
    );
    return () => unsubs.forEach((u) => u());
  }, [idKey]);

  const children = useMemo(() => (idKey ? idKey.split(',') : []).map((id) => students[id] || { id, loading: true }), [idKey, students]);
  return { loading: links.loading, error: links.error, children };
}

/** Session summaries for one student inside [start, end). */
export function useWeekSummaries(studentId, start, end) {
  return useQuery(
    () =>
      studentId
        ? query(
            collection(db, 'sessionSummaries'),
            where('studentId', '==', studentId),
            where('completedAt', '>=', start),
            where('completedAt', '<', end),
            orderBy('completedAt', 'asc')
          )
        : null,
    [studentId, start, end]
  );
}

/** Totals for a list of session summaries. */
export function summarize(summaries, start) {
  let seen = 0;
  let answered = 0;
  let correct = 0;
  const days = Array.from({ length: 7 }, () => ({ questions: 0, sessions: 0 }));
  const badges = [];
  const cards = [];
  const topics = [];
  const topicCategory = {};
  for (const s of summaries) {
    seen += s.seen || 0;
    answered += s.answered || 0;
    correct += s.correct || 0;
    const inWeek = s.completedAt >= start;
    const idx = (new Date(s.completedAt || 0).getDay() + 6) % 7;
    if (inWeek) {
      days[idx].questions += s.seen || 0;
      days[idx].sessions += 1;
    }
    for (const b of s.newBadges || []) if (!badges.includes(b)) badges.push(b);
    for (const c of s.newCards || []) if (!cards.includes(c)) cards.push(c);
    const cats = Object.keys(s.byCategory || {});
    for (const t of s.topics || []) {
      if (!topics.includes(t)) topics.push(t);
      if (!topicCategory[t] && cats.length === 1) topicCategory[t] = cats[0];
    }
  }
  return {
    seen,
    answered,
    correct,
    accuracy: answered ? Math.round((correct / answered) * 100) : null,
    sessions: summaries.length,
    activeDays: days.filter((d) => d.sessions > 0).length,
    days,
    badges,
    cards,
    topics,
    topicCategory
  };
}
