'use strict';

// One fake database per Jest worker, shared by the jest.mock factory and
// the contract test (jest.mock factories cannot close over test variables).
const { loadSchema, loadNullability } = require('./schema');
const { createFakeDatabase } = require('./fakeDatabase');

module.exports = createFakeDatabase({ schema: loadSchema(), nullable: loadNullability() });
