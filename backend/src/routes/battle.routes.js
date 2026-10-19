'use strict';

const express = require('express');
const { verifyFirebaseToken } = require('../middleware/auth.middleware');
const { battleChallengeLimiter, incomingChallengeLimiter, challengeResponseLimiter } = require('../middleware/rateLimit.middleware');
const { requireUuidParam } = require('../utils/ids');
const {
  createChallenge,
  getBattle,
  markReady,
  reportDisconnect,
  reportReconnect,
  resolveBattle,
  listIncomingChallenges,
  acceptChallenge,
  declineChallenge,
} = require('../controllers/battle.controller');

const router = express.Router();
const battleId = requireUuidParam('battleId', 'BATTLE_NOT_FOUND', 'No battle exists with this id.');

router.post('/battle/challenge', verifyFirebaseToken, battleChallengeLimiter, createChallenge);
// Before /battle/:battleId, which would otherwise take "incoming" as an id.
router.get('/battle/incoming', verifyFirebaseToken, incomingChallengeLimiter, listIncomingChallenges);
router.get('/battle/:battleId', verifyFirebaseToken, battleId, getBattle);
router.post('/battle/:battleId/accept', verifyFirebaseToken, battleId, challengeResponseLimiter, acceptChallenge);
router.post('/battle/:battleId/decline', verifyFirebaseToken, battleId, challengeResponseLimiter, declineChallenge);
router.post('/battle/:battleId/ready', verifyFirebaseToken, battleId, markReady);
router.post('/battle/:battleId/disconnect', verifyFirebaseToken, battleId, reportDisconnect);
router.post('/battle/:battleId/reconnect', verifyFirebaseToken, battleId, reportReconnect);
router.post('/battle/:battleId/resolve', verifyFirebaseToken, battleId, resolveBattle);

module.exports = router;
