# Security Specification (`security_spec.md`)

## 1. Data Invariants

1. **Global Default Deny**: Any path not explicitly matched is unconditionally denied (`allow read, write: if false;`).
2. **Path Variable Hardening**: Every single-document operation (`get`, `create`, `update`, `delete`) validates its path ID variable with `isValidId(id)` (`id is string && id.size() >= 1 && id.size() <= 128 && id.matches('^[a-zA-Z0-9_\\-]+$')`).
3. **User Identity & Privilege Escalation Guard (`/users/{userId}`)**:
   - Users can only create their own profile (`userId == request.auth.uid` and `incoming().uid == request.auth.uid`).
   - Upon creation, regular users cannot self-assign privileged roles or inflated vote weights: `role == 'viewer'`, `xp == 0`, `voteWeight == 1.0`.
   - Profile updates by owners can only modify `displayName`, `avatarUrl`, and `updatedAt`. RBAC fields (`role`, `xp`, `voteWeight`) can only be updated by `isAdmin()`.
4. **CriteriaScores Matrix Invariant**:
   - Any `CriteriaScores` map (`expertScore`, `communityScore`, `liveExpertDraft`) must strictly contain only the 5 keys `['lyrics', 'flow', 'production', 'identity', 'vibe']`, and each value must be a number between `1` and `10`.
5. **Track Lifecycle & Integrity (`/tracks/{trackId}`)**:
   - A track can only be created if the submitter is authenticated and verified (`isVerified()`), `incoming().id == trackId`, `incoming().submittedBy == request.auth.uid`, and the user profile `exists(/databases/$(database)/documents/users/$(request.auth.uid))`.
   - Upon creation, `status` must be `'pending'`, `expertScore == null`, `communityScore == null`, `metaScore == null`, and `communityVotesCount == 0`.
   - Terminal State Lock: Once a track reaches `existing().status in ['reviewed', 'rejected']`, non-admin updates are locked.
6. **LiveSession Stream Control (`/liveSessions/{sessionId}`)**:
   - Only the session host (`hostId == request.auth.uid`) or an administrator (`isAdmin()`) can create or update a `LiveSession`.
   - Every write enforces strict schema validation via `isValidLiveSession(incoming(), sessionId)` and server timestamp verification (`updatedAt == request.time`).

---

## 2. The "Dirty Dozen" Payloads

1. **Payload 1 (Self-Admin Role Escalation on User Create)**:
   `POST /users/user_123` with `{ uid: "user_123", role: "admin", voteWeight: 10, xp: 99999 }` by a non-admin user.
2. **Payload 2 (Shadow Field Injection on User Update)**:
   `PATCH /users/user_123` adding `{ isSuperAdmin: true }` alongside valid fields.
3. **Payload 3 (Unverified Email Spoofing Attack)**:
   Request with `request.auth.token.email == 'hardsize@mail.ru'` but `email_verified == false` attempting admin write.
4. **Payload 4 (Cross-User Profile Hijack)**:
   Authenticated user `attacker_1` attempting `GET /users/victim_2` or `PATCH /users/victim_2`.
5. **Payload 5 (ID Poisoning / 2KB Path ID)**:
   Document ID exceeding 128 chars or containing invalid regex characters (`track_!@#$%^&*()`).
6. **Payload 6 (Orphaned Track Creation without User Profile)**:
   Creating `/tracks/track_1` when `/users/$(request.auth.uid)` does not exist.
7. **Payload 7 (Pre-Scored Track Submission)**:
   Submitting a new track with `status: 'reviewed'` and `metaScore: 100` on creation.
8. **Payload 8 (Out-of-Bounds CriteriaScores)**:
   Updating `expertScore` with `{ lyrics: 99, flow: -5, production: 10, identity: 10, vibe: 10 }`.
9. **Payload 9 (Terminal State Mutation)**:
   Non-admin attempting to modify a track whose `existing().status` is already `'reviewed'`.
10. **Payload 10 (Forged Timestamp Replay)**:
    Writing a document where `createdAt` or `updatedAt` does not match `request.time`.
11. **Payload 11 (Unauthorized OBS Stream Hijack)**:
    Regular viewer attempting `PATCH /liveSessions/current` to change `activeTrackId` or `votingOpen`.
12. **Payload 12 (Value Poisoning on Whitelisted Update Key)**:
    Owner updating `displayName` on `/users/user_123` with a 10,000-character string or a boolean value.
