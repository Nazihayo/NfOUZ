'use strict';

process.env.NODE_ENV = 'test';

const request = require('supertest');

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
  checkConnection: jest.fn(),
  shutdown: jest.fn(),
  pool: { on: jest.fn(), query: jest.fn() },
}));

jest.mock('../src/config/firebase', () => ({
  initializeFirebase: jest.fn(),
  checkFirebaseReady: jest.fn(),
  verifyIdToken: jest.fn(),
  admin: {},
}));

const { checkConnection } = require('../src/config/database');
const { checkFirebaseReady } = require('../src/config/firebase');
const createApp = require('../src/app');

describe('GET /health', () => {
  let app;

  beforeEach(() => {
    jest.clearAllMocks();
    app = createApp();
  });

  it('returns 200 and status ok when all dependencies are healthy', async () => {
    checkConnection.mockResolvedValue(true);
    checkFirebaseReady.mockReturnValue(true);

    const response = await request(app).get('/health');

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.status).toBe('ok');
    expect(response.body.data.checks).toEqual({ database: 'ok', firebase: 'ok' });
    expect(response.body.error).toBeNull();
  });

  it('returns 503 and status degraded when the database is unreachable', async () => {
    checkConnection.mockResolvedValue(false);
    checkFirebaseReady.mockReturnValue(true);

    const response = await request(app).get('/health');

    expect(response.status).toBe(503);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe('SERVICE_DEGRADED');
  });

  it('returns 503 when firebase is not initialized', async () => {
    checkConnection.mockResolvedValue(true);
    checkFirebaseReady.mockReturnValue(false);

    const response = await request(app).get('/health');

    expect(response.status).toBe(503);
    expect(response.body.data).toBeNull();
  });

  it('echoes back a provided X-Request-Id header', async () => {
    checkConnection.mockResolvedValue(true);
    checkFirebaseReady.mockReturnValue(true);

    const response = await request(app).get('/health').set('X-Request-Id', 'test-request-123');

    expect(response.headers['x-request-id']).toBe('test-request-123');
  });

  it('returns 404 for unknown routes with the standard envelope', async () => {
    const response = await request(app).get('/does-not-exist');

    expect(response.status).toBe(404);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe('NOT_FOUND');
  });
});
