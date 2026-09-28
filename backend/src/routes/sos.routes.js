'use strict';

const express = require('express');
const { verifyFirebaseToken } = require('../middleware/auth.middleware');
const { sosCreateLimiter } = require('../middleware/rateLimit.middleware');
const { createSos, getSos } = require('../controllers/sos.controller');

const router = express.Router();

router.post('/sos', verifyFirebaseToken, sosCreateLimiter, createSos);
router.get('/sos/:sosId', verifyFirebaseToken, getSos);

module.exports = router;
