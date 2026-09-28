'use strict';

const express = require('express');
const { verifyFirebaseToken } = require('../middleware/auth.middleware');
const { listInventory, equip, use } = require('../controllers/inventory.controller');

const router = express.Router();

router.get('/inventory', verifyFirebaseToken, listInventory);
router.post('/inventory/equip', verifyFirebaseToken, equip);
router.post('/inventory/use', verifyFirebaseToken, use);

module.exports = router;
