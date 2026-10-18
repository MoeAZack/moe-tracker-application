function sessionIsFresh(session, now = Date.now(), renewalWindowMs = 5 * 60 * 1000) {
  return !!session?.key && Date.parse(session.expiresAt || '') > now + renewalWindowMs;
}

function isTrustedSenderUrl(senderUrl, port) {
  try {
    const sender = new URL(String(senderUrl || ''));
    return sender.protocol === 'http:' && sender.origin === `http://127.0.0.1:${port}`;
  } catch { return false; }
}

module.exports = { sessionIsFresh, isTrustedSenderUrl };
