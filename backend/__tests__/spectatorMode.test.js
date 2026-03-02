const attachSocketHandlers = require('../controllers/socketHandlers');

describe('spectator mode helpers', () => {
  test('isSpectatorJoinRequest detects spectator mode safely', () => {
    const { isSpectatorJoinRequest } = attachSocketHandlers._internal;

    expect(isSpectatorJoinRequest('spectator')).toBe(true);
    expect(isSpectatorJoinRequest('SPECTATOR')).toBe(true);
    expect(isSpectatorJoinRequest('player')).toBe(false);
    expect(isSpectatorJoinRequest(undefined)).toBe(false);
  });
});
