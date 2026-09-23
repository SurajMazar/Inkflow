import { Injectable } from '@nestjs/common';
import {
  PRESENCE_TTL_SECONDS,
  presenceKey,
  type PeerPresence,
  type PresenceState,
} from '@inkflow/collaboration';
import { RedisService } from '../redis/redis.service';

export const DEFAULT_PRESENCE_STATE: PresenceState = {
  cursor: null,
  selectedIds: [],
  tool: 'selection',
  viewport: null,
  editingId: null,
  active: false,
};

/** Presence of collaborators per board, stored in a Redis hash (field = clientId) with a TTL. */
@Injectable()
export class PresenceService {
  constructor(private readonly redis: RedisService) {}

  async put(boardId: string, peer: PeerPresence): Promise<void> {
    const key = presenceKey(boardId);
    await this.redis.client
      .multi()
      .hset(key, peer.clientId, JSON.stringify(peer))
      .expire(key, PRESENCE_TTL_SECONDS)
      .exec();
  }

  async remove(boardId: string, clientId: string): Promise<void> {
    await this.redis.client.hdel(presenceKey(boardId), clientId);
  }

  /** Live peers of a board; entries not refreshed within the TTL are dropped (and cleaned up). */
  async list(boardId: string, now = Date.now()): Promise<PeerPresence[]> {
    const key = presenceKey(boardId);
    const raw = await this.redis.client.hgetall(key);
    const peers: PeerPresence[] = [];
    const stale: string[] = [];
    for (const [field, value] of Object.entries(raw)) {
      try {
        const peer = JSON.parse(value) as PeerPresence;
        if (now - peer.lastSeen > PRESENCE_TTL_SECONDS * 1000) stale.push(field);
        else peers.push(peer);
      } catch {
        stale.push(field);
      }
    }
    if (stale.length > 0) await this.redis.client.hdel(key, ...stale);
    return peers;
  }
}
