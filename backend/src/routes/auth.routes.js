'use strict';

const express = require('express');
const { verifyFirebaseToken } = require('../middleware/auth.middleware');
const { register, me } = require('../controllers/auth.controller');

const router = express.Router();

router.post('/auth/register', verifyFirebaseToken, register);
router.get('/auth/me', verifyFirebaseToken, me);

module.exports = router;
