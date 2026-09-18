// Rewards (/play/rewards) moved: badges, knowledge cards, and world stars now live in
// the Quiz Hall (/play/hall); rivals live in the QuizDex. Old links land in the Hall.
import { Navigate } from 'react-router-dom';

export default function Rewards() {
  return <Navigate to="/play/hall" replace />;
}
