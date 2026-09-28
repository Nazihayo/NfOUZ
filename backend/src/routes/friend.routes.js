'use strict';

const express = require('express');
const { verifyFirebaseToken } = require('../middleware/auth.middleware');
const { friendRequestLimiter } = require('../middleware/rateLimit.middleware');
const {
  sendRequest,
  acceptRequest,
  declineRequest,
  removeFriend,
  blockPlayer,
  unblockPlayer,
  listPendingRequests,
  listFriends,
} = require('../controllers/friend.controller');

const router = express.Router();

router.get('/friends', verifyFirebaseToken, listFriends);
router.get('/friends/requests', verifyFirebaseToken, listPendingRequests);
router.post('/friends/request', verifyFirebaseToken, friendRequestLimiter, sendRequest);
router.post('/friends/accept', verifyFirebaseToken, acceptRequest);
router.post('/friends/decline', verifyFirebaseToken, declineRequest);
router.delete('/friends/:playerId', verifyFirebaseToken, removeFriend);
router.post('/friends/block', verifyFirebaseToken, blockPlayer);
router.post('/friends/unblock', verifyFirebaseToken, unblockPlayer);

module.exports = router;
