'use strict';

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');

const env = require('./config/env');
const requestId = require('./middleware/requestId');
const { errorHandler, notFoundHandler } = require('./middleware/errorHandler');
const healthRoutes = require('./routes/health.routes');
const authRoutes = require('./routes/auth.routes');
const playerRoutes = require('./routes/player.routes');
const battleRoutes = require('./routes/battle.routes');
const friendRoutes = require('./routes/friend.routes');
const sosRoutes = require('./routes/sos.routes');
const rescueRoutes = require('./routes/rescue.routes');
const inventoryRoutes = require('./routes/inventory.routes');
const questRoutes = require('./routes/quest.routes');
const logger = require('./utils/logger');

function createApp() {
  const app = express();

  app.disable('x-powered-by');
  app.use(helmet());
  app.use(
    cors({
      origin: env.CORS_ALLOWED_ORIGINS.includes('*') ? true : env.CORS_ALLOWED_ORIGINS,
    })
  );
  app.use(express.json({ limit: '1mb' }));
  app.use(requestId);

  if (!env.IS_TEST) {
    app.use((req, res, next) => {
      logger.info('Incoming request', { requestId: req.requestId, method: req.method, path: req.path });
      next();
    });
  }

  // Sprint 1: health. Sprint 2: auth. Sprint 3: player location/nearby.
  // Sprint 5: battle challenge/session (Photon Multiplayer Foundation).
  // Sprint 8: friends, SOS, rescue.
  app.use('/', healthRoutes);
  app.use('/', authRoutes);
  app.use('/', playerRoutes);
  app.use('/', battleRoutes);
  app.use('/', friendRoutes);
  app.use('/', sosRoutes);
  app.use('/', rescueRoutes);
  // Sprint 9: Inventory + Quest System (player progression outside combat).
  app.use('/', inventoryRoutes);
  app.use('/', questRoutes);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

module.exports = createApp;
