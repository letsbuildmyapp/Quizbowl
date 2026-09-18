import { Suspense, lazy } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import {
  Award,
  BarChart3,
  BookOpen,
  ClipboardList,
  Flag,
  Gamepad2,
  Home,
  Inbox,
  Layers,
  LayoutDashboard,
  Map,
  School,
  Settings,
  Shield,
  Swords,
  Trophy,
  Users
} from 'lucide-react';
import { AppShell, RequireRole, ScrollToTop } from './components/AppShell.jsx';
import { Loading } from './components/ui.jsx';
import { useAuth, homeFor } from './hooks/useAuth.jsx';
import { useAccessibilityPrefs } from './hooks/useAccessibility.js';

const p = (loader) => lazy(loader);

// Public
const Landing = p(() => import('./pages/public/Landing.jsx'));
const Privacy = p(() => import('./pages/public/Privacy.jsx'));
const PilotRequest = p(() => import('./pages/public/PilotRequest.jsx'));
const Login = p(() => import('./pages/public/Login.jsx'));
const StudentLogin = p(() => import('./pages/public/StudentLogin.jsx'));
const TeacherLogin = p(() => import('./pages/public/TeacherLogin.jsx'));
const ParentLogin = p(() => import('./pages/public/ParentLogin.jsx'));
const FinishSignIn = p(() => import('./pages/public/FinishSignIn.jsx'));
const Onboarding = p(() => import('./pages/public/Onboarding.jsx'));
const NotFound = p(() => import('./pages/public/NotFound.jsx'));

// Student
const StudentHome = p(() => import('./pages/student/Home.jsx'));
const Modes = p(() => import('./pages/student/Modes.jsx'));
const Worlds = p(() => import('./pages/student/Worlds.jsx'));
const Match = p(() => import('./pages/student/Match.jsx'));
const Results = p(() => import('./pages/student/Results.jsx'));
const ReviewDeck = p(() => import('./pages/student/ReviewDeck.jsx'));
const Rewards = p(() => import('./pages/student/Rewards.jsx'));
const Progress = p(() => import('./pages/student/Progress.jsx'));
const Leaderboard = p(() => import('./pages/student/Leaderboard.jsx'));
const StudentSettings = p(() => import('./pages/student/Settings.jsx'));
const TeamQuest = p(() => import('./pages/student/TeamQuest.jsx'));

// Teacher
const Dashboard = p(() => import('./pages/teacher/Dashboard.jsx'));
const Classes = p(() => import('./pages/teacher/Classes.jsx'));
const Students = p(() => import('./pages/teacher/Students.jsx'));
const StudentDetail = p(() => import('./pages/teacher/StudentDetail.jsx'));
const Assignments = p(() => import('./pages/teacher/Assignments.jsx'));
const Competitions = p(() => import('./pages/teacher/Competitions.jsx'));
const LiveHost = p(() => import('./pages/teacher/LiveHost.jsx'));
const Reports = p(() => import('./pages/teacher/Reports.jsx'));
const AnswerReviews = p(() => import('./pages/teacher/AnswerReviews.jsx'));
const ClassSettings = p(() => import('./pages/teacher/ClassSettings.jsx'));
const SchoolAdmin = p(() => import('./pages/teacher/School.jsx'));
const Feedback = p(() => import('./pages/teacher/Feedback.jsx'));

// Parent
const FamilyHome = p(() => import('./pages/parent/FamilyHome.jsx'));
const ChildSummary = p(() => import('./pages/parent/ChildSummary.jsx'));
const FamilyPrivacy = p(() => import('./pages/parent/FamilyPrivacy.jsx'));
const FamilySettings = p(() => import('./pages/parent/FamilySettings.jsx'));

// Admin
const AdminHome = p(() => import('./pages/admin/AdminHome.jsx'));
const Content = p(() => import('./pages/admin/Content.jsx'));
const QuestionEditor = p(() => import('./pages/admin/QuestionEditor.jsx'));
const ContentImport = p(() => import('./pages/admin/ContentImport.jsx'));
const Flags = p(() => import('./pages/admin/Flags.jsx'));
const Schools = p(() => import('./pages/admin/Schools.jsx'));
const AdminUsers = p(() => import('./pages/admin/Users.jsx'));
const Audit = p(() => import('./pages/admin/Audit.jsx'));
const PrivacyQueue = p(() => import('./pages/admin/PrivacyQueue.jsx'));
const Pilots = p(() => import('./pages/admin/Pilots.jsx'));

const STUDENT_NAV = [
  { to: '/play', label: 'Home', icon: Home, end: true },
  { to: '/play/worlds', label: 'Worlds', icon: Map },
  { to: '/play/modes', label: 'Play', icon: Gamepad2 },
  { to: '/play/rewards', label: 'Rewards', icon: Award },
  { to: '/play/progress', label: 'Progress', icon: BarChart3, short: 'Stats' },
  { to: '/play/leaderboard', label: 'Leaderboard', icon: Trophy },
  { to: '/play/review', label: 'Review Deck', icon: Layers },
  { to: '/play/settings', label: 'Settings', icon: Settings }
];

function teacherNav(auth) {
  const nav = [
    { to: '/teach', label: 'Dashboard', icon: LayoutDashboard, end: true },
    { to: '/teach/students', label: 'Students', icon: Users },
    { to: '/teach/assignments', label: 'Assignments', icon: ClipboardList },
    { to: '/teach/competitions', label: 'Competitions', icon: Swords },
    { to: '/teach/reviews', label: 'Answer Reviews', icon: Inbox },
    { to: '/teach/reports', label: 'Reports', icon: BarChart3 },
    { to: '/teach/settings', label: 'Class Settings', icon: Settings }
  ];
  if (auth.isSchoolAdmin) nav.push({ to: '/teach/school', label: 'School', icon: School });
  if (auth.isContentAdmin || auth.isPlatformAdmin) nav.push({ to: '/admin', label: 'Admin', icon: Shield });
  return nav;
}

const PARENT_NAV = [
  { to: '/family', label: 'My Family', icon: Home, end: true },
  { to: '/family/privacy', label: 'Privacy', icon: Shield },
  { to: '/family/settings', label: 'Settings', icon: Settings }
];

function adminNav(auth) {
  const nav = [];
  if (auth.isPlatformAdmin) nav.push({ to: '/admin', label: 'Overview', icon: BarChart3, end: true });
  if (auth.isContentAdmin || auth.isPlatformAdmin) {
    nav.push({ to: '/admin/content', label: 'Content', icon: BookOpen });
    nav.push({ to: '/admin/flags', label: 'Flags', icon: Flag });
  }
  if (auth.isPlatformAdmin) {
    nav.push({ to: '/admin/schools', label: 'Schools', icon: School });
    nav.push({ to: '/admin/users', label: 'Users', icon: Users });
    nav.push({ to: '/admin/privacy', label: 'Privacy', icon: Shield });
    nav.push({ to: '/admin/audit', label: 'Audit', icon: ClipboardList });
    nav.push({ to: '/admin/pilots', label: 'Pilots', icon: Inbox });
  }
  if (auth.isTeacher) nav.push({ to: '/teach', label: 'Teacher view', icon: LayoutDashboard });
  return nav;
}

function RoleHome() {
  const auth = useAuth();
  if (auth.loading) return <Loading full />;
  return <Navigate to={homeFor(auth)} replace />;
}

export default function App() {
  const auth = useAuth();
  useAccessibilityPrefs(auth.student?.settings);
  return (
    <>
      <ScrollToTop />
      <Suspense fallback={<Loading full />}>
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/privacy" element={<Privacy />} />
          <Route path="/pilot" element={<PilotRequest />} />
          <Route path="/login" element={<Login />} />
          <Route path="/login/student" element={<StudentLogin />} />
          <Route path="/login/teacher" element={<TeacherLogin />} />
          <Route path="/login/family" element={<ParentLogin />} />
          <Route path="/finish-signin" element={<FinishSignIn />} />
          <Route path="/onboarding/*" element={<Onboarding />} />
          <Route path="/home" element={<RoleHome />} />

          {/* The match screen is full-bleed (no nav) so kids can focus. */}
          <Route
            path="/play/match/:sessionId"
            element={
              <RequireRole allow={(a) => a.isStudent}>
                <Match />
              </RequireRole>
            }
          />
          <Route
            path="/play"
            element={
              <RequireRole allow={(a) => a.isStudent}>
                <AppShell nav={STUDENT_NAV} bottom home="/play" />
              </RequireRole>
            }
          >
            <Route index element={<StudentHome />} />
            <Route path="modes" element={<Modes />} />
            <Route path="worlds" element={<Worlds />} />
            <Route path="results/:sessionId" element={<Results />} />
            <Route path="review" element={<ReviewDeck />} />
            <Route path="rewards" element={<Rewards />} />
            <Route path="progress" element={<Progress />} />
            <Route path="leaderboard" element={<Leaderboard />} />
            <Route path="settings" element={<StudentSettings />} />
            <Route path="team" element={<TeamQuest />} />
          </Route>

          <Route
            path="/teach/live/:sessionId"
            element={
              <RequireRole allow={(a) => a.isTeacher}>
                <LiveHost />
              </RequireRole>
            }
          />
          <Route
            path="/teach"
            element={
              <RequireRole allow={(a) => a.isTeacher}>
                <AppShell nav={teacherNav(auth)} home="/teach" />
              </RequireRole>
            }
          >
            <Route index element={<Dashboard />} />
            <Route path="classes" element={<Classes />} />
            <Route path="students" element={<Students />} />
            <Route path="students/:studentId" element={<StudentDetail />} />
            <Route path="assignments" element={<Assignments />} />
            <Route path="competitions" element={<Competitions />} />
            <Route path="reports" element={<Reports />} />
            <Route path="reviews" element={<AnswerReviews />} />
            <Route path="settings" element={<ClassSettings />} />
            <Route path="school" element={<SchoolAdmin />} />
            <Route path="feedback" element={<Feedback />} />
          </Route>

          <Route
            path="/family"
            element={
              <RequireRole allow={(a) => a.isParent}>
                <AppShell nav={PARENT_NAV} bottom home="/family" />
              </RequireRole>
            }
          >
            <Route index element={<FamilyHome />} />
            <Route path="child/:studentId" element={<ChildSummary />} />
            <Route path="privacy" element={<FamilyPrivacy />} />
            <Route path="settings" element={<FamilySettings />} />
          </Route>

          <Route
            path="/admin"
            element={
              <RequireRole allow={(a) => a.isContentAdmin || a.isPlatformAdmin}>
                <AppShell nav={adminNav(auth)} home="/admin" />
              </RequireRole>
            }
          >
            <Route index element={auth.isPlatformAdmin ? <AdminHome /> : <Navigate to="/admin/content" replace />} />
            <Route path="content" element={<Content />} />
            <Route path="content/import" element={<ContentImport />} />
            <Route path="content/:questionId" element={<QuestionEditor />} />
            <Route path="flags" element={<Flags />} />
            <Route path="schools" element={<Schools />} />
            <Route path="users" element={<AdminUsers />} />
            <Route path="audit" element={<Audit />} />
            <Route path="privacy" element={<PrivacyQueue />} />
            <Route path="pilots" element={<Pilots />} />
          </Route>

          <Route path="*" element={<NotFound />} />
        </Routes>
      </Suspense>
    </>
  );
}
