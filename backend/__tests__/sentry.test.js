const { productionDsn } = require('../../config/sentry.json');

const originalEnv = process.env;
const init = jest.fn();
const execFileSync = jest.fn();

beforeEach(() => {
  jest.resetModules();
  process.env = { ...originalEnv, NODE_ENV: 'production' };
  delete process.env.SENTRY_DSN;
  delete process.env.SENTRY_ENVIRONMENT;
  init.mockClear();
  execFileSync.mockReset();
  jest.doMock('dotenv', () => ({ config: jest.fn() }));
  jest.doMock('@sentry/node', () => ({ init }));
  jest.doMock('node:child_process', () => ({ execFileSync }));
});

afterEach(() => {
  process.env = originalEnv;
});

test.each([
  ['https://github.com/DhananjayThomble/GridLock.git', productionDsn],
  ['git@github.com:DhananjayThomble/GridLock.git', productionDsn],
  ['https://github.com/student/GridLock.git', undefined],
])('selects the production default DSN for Git origin %s', (origin, expectedDsn) => {
  execFileSync.mockImplementation((_command, args) => (
    args[0] === 'config' ? origin : 'test-commit'
  ));

  expect(require('../lib/sentry').initialized).toBe(Boolean(expectedDsn));
  if (expectedDsn) {
    expect(init).toHaveBeenCalledWith(expect.objectContaining({ dsn: expectedDsn }));
  } else {
    expect(init).not.toHaveBeenCalled();
  }
});

test.each(['https://public@example.invalid/1', ''])('honors an explicit DSN override %p', (dsn) => {
  process.env.SENTRY_DSN = dsn;
  execFileSync.mockReturnValue('test-commit');

  expect(require('../lib/sentry').initialized).toBe(Boolean(dsn));
  expect(execFileSync).not.toHaveBeenCalledWith(
    'git',
    expect.arrayContaining(['config']),
    expect.anything(),
  );
  if (dsn) {
    expect(init).toHaveBeenCalledWith(expect.objectContaining({ dsn }));
  } else {
    expect(init).not.toHaveBeenCalled();
  }
});
