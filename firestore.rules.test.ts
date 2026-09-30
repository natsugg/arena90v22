/**
 * Firestore Security Rules Test Suite — Verifies that all "Dirty Dozen"
 * adversarial payloads return PERMISSION_DENIED.
 */

export interface SecurityTestCase {
  id: number;
  name: string;
  collection: string;
  operation: 'get' | 'list' | 'create' | 'update' | 'delete';
  expectedResult: 'PERMISSION_DENIED';
  payload?: Record<string, unknown>;
}

export const DIRTY_DOZEN_TESTS: SecurityTestCase[] = [
  {
    id: 1,
    name: 'Self-Admin Role Escalation on User Create',
    collection: '/users/user_123',
    operation: 'create',
    expectedResult: 'PERMISSION_DENIED',
    payload: {
      uid: 'user_123',
      displayName: 'Attacker',
      role: 'admin',
      xp: 99999,
      voteWeight: 10.0,
    },
  },
  {
    id: 2,
    name: 'Shadow Field Injection on User Update',
    collection: '/users/user_123',
    operation: 'update',
    expectedResult: 'PERMISSION_DENIED',
    payload: {
      displayName: 'Valid Name',
      isVerifiedAdmin: true,
    },
  },
  {
    id: 3,
    name: 'Unverified Email Spoofing Attack',
    collection: '/liveSessions/current',
    operation: 'update',
    expectedResult: 'PERMISSION_DENIED',
    payload: {
      isLive: true,
    },
  },
  {
    id: 4,
    name: 'Unauthorized Track Creation by Ordinary Viewer/VIP',
    collection: '/tracks/track_viewer_1',
    operation: 'create',
    expectedResult: 'PERMISSION_DENIED',
    payload: {
      id: 'track_viewer_1',
      submittedBy: 'viewer_1',
      status: 'in_queue',
    },
  },
  {
    id: 5,
    name: 'ID Poisoning Guard on Invalid Document ID',
    collection: '/tracks/invalid$id!with*bad^chars',
    operation: 'create',
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 6,
    name: 'Orphaned Track Creation Without Existing Publisher User Document',
    collection: '/tracks/track_1',
    operation: 'create',
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 7,
    name: 'Pre-Scored Track Submission Bypass',
    collection: '/tracks/track_1',
    operation: 'create',
    expectedResult: 'PERMISSION_DENIED',
    payload: {
      status: 'reviewed',
      metaScore: 100,
    },
  },
  {
    id: 8,
    name: 'Out-of-Bounds CriteriaScores (Score > 10)',
    collection: '/tracks/track_1',
    operation: 'update',
    expectedResult: 'PERMISSION_DENIED',
    payload: {
      expertScore: {
        lyrics: 99,
        flow: -2,
        production: 10,
        identity: 10,
        vibe: 10,
      },
    },
  },
  {
    id: 9,
    name: 'Terminal State Mutation on Reviewed Track',
    collection: '/tracks/track_reviewed',
    operation: 'update',
    expectedResult: 'PERMISSION_DENIED',
    payload: {
      title: 'Changed Title After Review',
    },
  },
  {
    id: 10,
    name: 'Forged Client Timestamp Replay',
    collection: '/users/user_123',
    operation: 'create',
    expectedResult: 'PERMISSION_DENIED',
    payload: {
      createdAt: '2020-01-01T00:00:00Z',
    },
  },
  {
    id: 11,
    name: 'Unauthorized Track or User Deletion by Non-Admin',
    collection: '/tracks/track_1',
    operation: 'delete',
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 12,
    name: 'Value Poisoning on Whitelisted Update Key',
    collection: '/users/user_123',
    operation: 'update',
    expectedResult: 'PERMISSION_DENIED',
    payload: {
      displayName: 'A'.repeat(1000),
    },
  },
];
