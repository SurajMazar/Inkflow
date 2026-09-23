import { randomUUID } from 'node:crypto';
import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import {
  boardChannel,
  presenceKey,
  type BoardEvent,
  type ServerMessage,
} from '@inkflow/collaboration';
import { RedisService } from '../redis/redis.service';

/** Instructions for gateways (not forwarded to clients). */
export type BusControl =
  /** Roles on the board changed: every socket re-resolves its effective role. */
  | 'recheck-access'
  /** The board was deleted: sockets are closed with `BOARD_DELETED`. */
  | 'board-deleted';

/** Message carried on `boardChannel(boardId)` between API instances. */
export interface BusEnvelope {
  /** Instance that published the message. */
  origin: string;
  /** Server message to deliver to the board's sockets. */
  msg?: ServerMessage;
  /** Client id that must not receive `msg` (e.g. the sender of a transient update). */
  exclude?: string;
  control?: BusControl;
}

export type BusHandler = (envelope: BusEnvelope) => void;

const CHANNEL_PREFIX = boardChannel('');

/**
 * Board-scoped pub/sub over Redis. Every API instance subscribes to the channels of boards that
 * have local sockets, so a message published anywhere reaches every connected client.
 */
@Injectable()
export class RealtimeService implements OnModuleInit {
  private readonly logger = new Logger(RealtimeService.name);
  readonly instanceId = randomUUID();
  private readonly handlers = new Map<string, Set<BusHandler>>();

  constructor(private readonly redis: RedisService) {}

  onModuleInit(): void {
    this.redis.subscriber.on('message', (channel: string, raw: string) => {
      if (!channel.startsWith(CHANNEL_PREFIX)) return;
      const boardId = channel.slice(CHANNEL_PREFIX.length);
      const handlers = this.handlers.get(boardId);
      if (!handlers || handlers.size === 0) return;
      let envelope: BusEnvelope;
      try {
        envelope = JSON.parse(raw) as BusEnvelope;
      } catch {
        return;
      }
      for (const handler of [...handlers]) {
        try {
          handler(envelope);
        } catch (err) {
          this.logger.error(`Bus handler failed for board ${boardId}: ${(err as Error).message}`);
        }
      }
    });
  }

  /** Registers a local handler for a board; returns an unsubscribe function. */
  async subscribe(boardId: string, handler: BusHandler): Promise<() => Promise<void>> {
    let set = this.handlers.get(boardId);
    if (!set) {
      set = new Set();
      this.handlers.set(boardId, set);
      await this.redis.subscriber.subscribe(boardChannel(boardId));
    }
    set.add(handler);
    return async () => {
      const current = this.handlers.get(boardId);
      if (!current) return;
      current.delete(handler);
      if (current.size === 0) {
        this.handlers.delete(boardId);
        await this.redis.subscriber.unsubscribe(boardChannel(boardId)).catch(() => undefined);
      }
    };
  }

  /** Boards with local subscribers. */
  subscribedBoards(): string[] {
    return [...this.handlers.keys()];
  }

  async publish(boardId: string, envelope: Omit<BusEnvelope, 'origin'>): Promise<void> {
    try {
      await this.redis.publisher.publish(
        boardChannel(boardId),
        JSON.stringify({ origin: this.instanceId, ...envelope }),
      );
    } catch (err) {
      this.logger.error(`Failed to publish to board ${boardId}: ${(err as Error).message}`);
    }
  }

  publishMessage(boardId: string, msg: ServerMessage, exclude?: string): Promise<void> {
    return this.publish(boardId, { msg, ...(exclude ? { exclude } : {}) });
  }

  /** Broadcasts a board event; permission changes and deletion also instruct the gateways. */
  emitEvent(boardId: string, event: BoardEvent): Promise<void> {
    const control: BusControl | undefined =
      event.kind === 'permissions-changed'
        ? 'recheck-access'
        : event.kind === 'board-deleted'
          ? 'board-deleted'
          : undefined;
    return this.publish(boardId, { msg: { t: 'event', event }, ...(control ? { control } : {}) });
  }

  /** Boards (of the given ids) that currently have connected collaborators on any instance. */
  async activeBoards(boardIds: string[]): Promise<string[]> {
    if (boardIds.length === 0) return [];
    const pipeline = this.redis.client.pipeline();
    for (const id of boardIds) pipeline.exists(presenceKey(id));
    const results = (await pipeline.exec()) ?? [];
    return boardIds.filter((_, i) => results[i]?.[1] === 1 || this.handlers.has(boardIds[i]!));
  }

  requestResync(boardId: string, reason: string): Promise<void> {
    return this.publishMessage(boardId, { t: 'resync', reason });
  }
}
