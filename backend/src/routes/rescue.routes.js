'use strict';

const express = require('express');
const { verifyFirebaseToken } = require('../middleware/auth.middleware');
const { acceptMission, startGuardBattle, resolveGuardBattle } = require('../controllers/rescue.controller');
const { requireUuidParam } = require('../utils/ids');

const router = express.Router();
const missionId = requireUuidParam('missionId', 'RESCUE_MISSION_NOT_FOUND', 'No rescue mission exists with this id.');

router.post('/rescue/accept', verifyFirebaseToken, acceptMission);
router.post('/rescue/:missionId/guard-battle/start', verifyFirebaseToken, missionId, startGuardBattle);
router.post('/rescue/:missionId/guard-battle/resolve', verifyFirebaseToken, missionId, resolveGuardBattle);

module.exports = router;
