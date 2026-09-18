// Assignment helpers shared by Dashboard, Assignments and Reports.
// Firestore reads: assignments where classroomId ==, assignments/{id}/progress/*.
import { collection, query, where } from 'firebase/firestore';
import { db } from '../../firebase.js';
import { useQuery } from '../../hooks/useFirestore.js';
import { ProgressBar } from '../ui.jsx';

export function useAssignments(classroomId) {
  const res = useQuery(() => (classroomId ? query(collection(db, 'assignments'), where('classroomId', '==', classroomId)) : null), [classroomId]);
  const data = res.data.slice().sort((a, b) => (b.dueAt || 0) - (a.dueAt || 0));
  return { ...res, data, current: data.filter((a) => !a.archived), archived: data.filter((a) => a.archived) };
}

/** Student ids an assignment targets, given the active roster. */
export function targetIds(assignment, activeRoster) {
  const t = assignment.targets || { type: 'class', ids: [] };
  if (t.type === 'team') return activeRoster.filter((s) => (t.ids || []).includes(s.teamId)).map((s) => s.id);
  if (t.type === 'students') return (t.ids || []).filter((id) => activeRoster.some((s) => s.id === id));
  return activeRoster.map((s) => s.id);
}

export function useAssignmentProgress(assignmentId) {
  return useQuery(() => (assignmentId ? collection(db, 'assignments', assignmentId, 'progress') : null), [assignmentId]);
}

/** "3 of 12 done" with a bar. Counts only targeted students who completed. */
export function AssignmentCompletion({ assignment, activeRoster, compact }) {
  const { data, loading, error } = useAssignmentProgress(assignment.id);
  const ids = targetIds(assignment, activeRoster);
  const done = data.filter((p) => p.completed && ids.includes(p.id)).length;
  if (error) return <span className="caption">Progress unavailable</span>;
  return (
    <div className="stack" style={{ gap: 6, minWidth: compact ? 140 : 200 }}>
      <span className="tabular" style={{ fontWeight: 800 }}>
        {loading ? '…' : `${done} of ${ids.length} done`}
      </span>
      <ProgressBar value={done} max={ids.length || 1} color="var(--teal)" label={`${assignment.title} completion`} />
    </div>
  );
}
