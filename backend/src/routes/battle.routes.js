'use strict';

const express = require('express');
const { verifyFirebaseToken } = require('../middleware/auth.middleware');
const { battleChallengeLimiter } = require('../middleware/rateLimit.middleware');
const { requireUuidParam } = require('../utils/ids');
const {
  createChallenge,
  getBattle,
  markReady,
  reportDisconnect,
  reportReconnect,
  resolveBattle,
} = require('../controllers/battle.controller');

const router = express.Router();
const battleId = requireUuidParam('battleId', 'BATTLE_NOT_FOUND', 'No battle exists with this id.');

router.post('/battle/challenge', verifyFirebaseToken, battleChallengeLimiter, createChallenge);
router.get('/battle/:battleId', verifyFirebaseToken, battleId, getBattle);
router.post('/battle/:battleId/ready', verifyFirebaseToken, battleId, markReady);
router.post('/battle/:battleId/disconnect', verifyFirebaseToken, battleId, reportDisconnect);
router.post('/battle/:battleId/reconnect', verifyFirebaseToken, battleId, reportReconnect);
router.post('/battle/:battleId/resolve', verifyFirebaseToken, battleId, resolveBattle);

module.exports = router;
