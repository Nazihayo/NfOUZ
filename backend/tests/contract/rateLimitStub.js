'use strict';

// Rate limiting is not part of the client contract, and the limiters'
// process-wide counters would turn repeated scenario calls into 429s.
const passThrough = (req, res, next) => next();

module.exports = {
  locationUpdateLimiter: passThrough,
  nearbyQueryLimiter: passThrough,
  battleChallengeLimiter: passThrough,
  friendRequestLimiter: passThrough,
  sosCreateLimiter: passThrough,
  incomingChallengeLimiter: passThrough,
  challengeResponseLimiter: passThrough,
};
