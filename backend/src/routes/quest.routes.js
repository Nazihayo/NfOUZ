'use strict';

const express = require('express');
const { verifyFirebaseToken } = require('../middleware/auth.middleware');
const { listQuests, claimQuest } = require('../controllers/quest.controller');
const { requireUuidParam } = require('../utils/ids');

const router = express.Router();

router.get('/quests', verifyFirebaseToken, listQuests);
router.post('/quests/:questId/claim', verifyFirebaseToken, requireUuidParam('questId', 'QUEST_NOT_FOUND', 'No such quest is assigned to you.'), claimQuest);

module.exports = router;
