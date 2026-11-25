import type { ServerPushEvent } from "@scuttle/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

export type EventSubscriber = (event: ServerPushEvent) => void;

export class EventBus extends Context.Service<
  EventBus,
  {
    readonly publish: (event: ServerPushEvent) => Effect.Effect<void>;
    readonly publishSync: (event: ServerPushEvent) => void;
    readonly subscribe: (listener: EventSubscriber) => () => void;
  }
>()("scuttle/server/EventBus") {}

const make = Effect.sync(() => {
  const subscribers = new Set<EventSubscriber>();

  const publishSync = (event: ServerPushEvent) => {
    for (const subscriber of subscribers) {
      try {
        subscriber(event);
      } catch {
        // Isolate misbehaving WebSocket subscribers from the publisher.
      }
    }
  };

  const publish = (event: ServerPushEvent) =>
    Effect.sync(() => {
      publishSync(event);
    });

  const subscribe = (listener: EventSubscriber) => {
    subscribers.add(listener);
    return () => {
      subscribers.delete(listener);
    };
  };

  return EventBus.of({ publish, publishSync, subscribe });
});

export const layer = Layer.effect(EventBus, make);
