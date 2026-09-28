'use strict';

const express = require('express');
const { verifyFirebaseToken } = require('../middleware/auth.middleware');
const { listQuests, claimQuest } = require('../controllers/quest.controller');

const router = express.Router();

router.get('/quests', verifyFirebaseToken, listQuests);
router.post('/quests/:questId/claim', verifyFirebaseToken, claimQuest);

module.exports = router;
