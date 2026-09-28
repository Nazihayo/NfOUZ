'use strict';

const express = require('express');
const { verifyFirebaseToken } = require('../middleware/auth.middleware');
const { locationUpdateLimiter, nearbyQueryLimiter } = require('../middleware/rateLimit.middleware');
const { updateLocation, getNearby, updateFcmToken, deactivateDevice, deactivateAllDevices } = require('../controllers/player.controller');

const router = express.Router();

router.patch('/player/:id/location', verifyFirebaseToken, locationUpdateLimiter, updateLocation);
router.get('/player/nearby', verifyFirebaseToken, nearbyQueryLimiter, getNearby);
router.patch('/player/:id/fcm-token', verifyFirebaseToken, updateFcmToken);
// Sprint 8 correction (final pass) — normal sign-out (current device only)
// vs. account-wide deactivation are now two distinct, explicit endpoints;
// see player.controller.js's doc comments for why they are kept separate.
router.post('/player/:id/devices/deactivate', verifyFirebaseToken, deactivateDevice);
router.post('/player/:id/devices/deactivate-all', verifyFirebaseToken, deactivateAllDevices);

module.exports = router;
