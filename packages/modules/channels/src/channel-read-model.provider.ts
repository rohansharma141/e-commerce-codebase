import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { EventBus } from '@platform/shared/event-bus';
import {
  CHANNELS_EVENTS,
  ChannelReadModel,
  type ChannelArchivedPayload,
  type ChannelCreatedPayload,
  type ChannelDefaultChangedPayload,
  type ChannelUpdatedPayload,
  type TenantDefaultsUpdatedPayload,
} from '@platform/modules/channels/contracts';
import { ChannelsService } from './channels.service';

/**
 * The injection token consumers depend on for channel reads.
 *
 * A token rather than the concrete class, so a consuming module never names
 * `ChannelsService` and the composition root decides what backs it. Today that
 * is a read-model over the in-process service; after extraction it is a
 * read-model over an HTTP client, and no consumer changes.
 */
export const CHANNEL_QUERY = Symbol('CHANNEL_QUERY');

/**
 * Keeps the read-model fed from the bus (C-14).
 *
 * Subscription lives here rather than inside `ChannelReadModel` because the
 * read-model is deliberately framework-free — it sits in `contracts/` so every
 * consuming module shares one implementation, and a class in `contracts/` must
 * not know about Nest or the bus.
 *
 * Handler errors are isolated by the bus, which matters more than usual here: a
 * throw while applying an event must not fail the operator's write. The replica
 * degrades to read-through on the next miss, which is exactly the fallback that
 * makes events an optimisation rather than a correctness requirement.
 */
@Injectable()
export class ChannelReadModelFeeder implements OnModuleInit {
  constructor(
    @Inject(CHANNEL_QUERY) private readonly readModel: ChannelReadModel,
    private readonly events: EventBus,
  ) {}

  onModuleInit(): void {
    this.events.subscribe(CHANNELS_EVENTS.Created, (e) => {
      this.readModel.onCreated(e.payload as ChannelCreatedPayload);
    });
    this.events.subscribe(CHANNELS_EVENTS.Updated, (e) => {
      this.readModel.onUpdated(e.payload as ChannelUpdatedPayload);
    });
    this.events.subscribe(CHANNELS_EVENTS.Archived, (e) => {
      this.readModel.onArchived(e.payload as ChannelArchivedPayload);
    });
    this.events.subscribe(CHANNELS_EVENTS.DefaultChanged, (e) => {
      this.readModel.onDefaultChanged(e.payload as ChannelDefaultChangedPayload);
    });
    this.events.subscribe(CHANNELS_EVENTS.TenantDefaultsUpdated, (e) => {
      this.readModel.onTenantDefaultsUpdated(e.payload as TenantDefaultsUpdatedPayload);
    });
  }
}

export const channelReadModelProvider = {
  provide: CHANNEL_QUERY,
  useFactory: (service: ChannelsService): ChannelReadModel => new ChannelReadModel(service),
  inject: [ChannelsService],
};
