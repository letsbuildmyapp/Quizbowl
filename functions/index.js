'use strict';

// QuizQuest Cloud Functions. Every entry point is a Firestore trigger or a
// schedule (no callable/HTTP functions: the GCP org forbids public invokers).
// See docs/DATA_MODEL.md for the request-document pattern.

const { setGlobalOptions } = require('firebase-functions/v2');

setGlobalOptions({ region: 'us-central1', maxInstances: 20 });

const identity = require('./src/identity');
const roster = require('./src/roster');
const game = require('./src/game');
const content = require('./src/content');
const reporting = require('./src/reporting');
const privacy = require('./src/privacy');

module.exports = {
  onStudentLogin: identity.onStudentLogin,
  onTeacherRequest: identity.onTeacherRequest,
  onParentRequest: identity.onParentRequest,
  onAdminAction: identity.onAdminAction,

  onClassroomWritten: roster.onClassroomWritten,
  onStudentWritten: roster.onStudentWritten,

  onSessionRequest: game.onSessionRequest,
  onSessionCommand: game.onSessionCommand,
  onSessionFinished: game.onSessionFinished,

  onQuestionWritten: content.onQuestionWritten,
  onQuestionSetWritten: content.onQuestionSetWritten,
  onContentImport: content.onContentImport,
  onContentFlag: content.onContentFlag,

  onAnswerReviewDecided: reporting.onAnswerReviewDecided,
  onAssignmentCreated: reporting.onAssignmentCreated,
  onAnalyticsEvent: reporting.onAnalyticsEvent,
  onPrivacyRequestCounted: reporting.onPrivacyRequestCounted,

  onPrivacyRequest: privacy.onPrivacyRequest,
  onPrivacyDecision: privacy.onPrivacyDecision,
  retentionSweep: privacy.retentionSweep,
  weeklyFamilySummary: privacy.weeklyFamilySummary
};
