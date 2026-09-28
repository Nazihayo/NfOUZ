'use strict';

const express = require('express');
const { verifyFirebaseToken } = require('../middleware/auth.middleware');
const { acceptMission, startGuardBattle, resolveGuardBattle } = require('../controllers/rescue.controller');

const router = express.Router();

router.post('/rescue/accept', verifyFirebaseToken, acceptMission);
router.post('/rescue/:missionId/guard-battle/start', verifyFirebaseToken, startGuardBattle);
router.post('/rescue/:missionId/guard-battle/resolve', verifyFirebaseToken, resolveGuardBattle);

module.exports = router;
