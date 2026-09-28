'use strict';

const express = require('express');
const { verifyFirebaseToken } = require('../middleware/auth.middleware');
const { battleChallengeLimiter } = require('../middleware/rateLimit.middleware');
const {
  createChallenge,
  getBattle,
  markReady,
  reportDisconnect,
  reportReconnect,
  resolveBattle,
} = require('../controllers/battle.controller');

const router = express.Router();

router.post('/battle/challenge', verifyFirebaseToken, battleChallengeLimiter, createChallenge);
router.get('/battle/:battleId', verifyFirebaseToken, getBattle);
router.post('/battle/:battleId/ready', verifyFirebaseToken, markReady);
router.post('/battle/:battleId/disconnect', verifyFirebaseToken, reportDisconnect);
router.post('/battle/:battleId/reconnect', verifyFirebaseToken, reportReconnect);
router.post('/battle/:battleId/resolve', verifyFirebaseToken, resolveBattle);

module.exports = router;
