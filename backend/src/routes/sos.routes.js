'use strict';

const express = require('express');
const { verifyFirebaseToken } = require('../middleware/auth.middleware');
const { sosCreateLimiter } = require('../middleware/rateLimit.middleware');
const { createSos, getSos } = require('../controllers/sos.controller');
const { requireUuidParam } = require('../utils/ids');

const router = express.Router();

router.post('/sos', verifyFirebaseToken, sosCreateLimiter, createSos);
router.get('/sos/:sosId', verifyFirebaseToken, requireUuidParam('sosId', 'SOS_NOT_FOUND', 'No SOS request exists with this id.'), getSos);

module.exports = router;
