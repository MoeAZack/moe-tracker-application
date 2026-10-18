'use strict';

function loginCredentials(config = {}, privileged = false) {
  const credentials = { key: config.adminPassword };
  const identity = config.identity;
  if (!privileged && config.role === 'player' && identity?.role === 'player' && typeof identity.playerId === 'string' && identity.playerId.trim() && typeof identity.displayName === 'string' && identity.displayName.trim()) {
    credentials.desktopIdentity = {
      role: 'player',
      playerId: identity.playerId.trim(),
      displayName: identity.displayName.trim()
    };
  }
  return credentials;
}

module.exports = { loginCredentials };
