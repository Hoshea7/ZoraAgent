export type SessionChannel = "awakening" | "productivity";

const sessions = new Map<SessionChannel, string>();

export function getSessionId(channel: SessionChannel): string | undefined {
  return sessions.get(channel);
}

export function setSessionId(channel: SessionChannel, sessionId: string): void {
  console.log(`[session-manager] Set ${channel} session: ${sessionId}`);
  sessions.set(channel, sessionId);
}

export function clearSessionId(channel: SessionChannel): void {
  console.log(`[session-manager] Clear ${channel} session`);
  sessions.delete(channel);
}

export function clearAllSessions(): void {
  sessions.clear();
}

export function hasSession(channel: SessionChannel): boolean {
  return sessions.has(channel);
}
