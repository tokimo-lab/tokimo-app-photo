import { useQueryClient } from "@tanstack/react-query";
import {
  type AppEntityEvent,
  useAppEntityEvents,
} from "@tokimo/sdk";
import { useCallback, useEffect, useRef } from "react";
import { api } from "../generated/rust-api";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function eventIdOf(event: AppEntityEvent): string | null {
  if (!isRecord(event.payload)) return null;
  const eventId = event.payload.eventId;
  return typeof eventId === "string" && eventId.length > 0 ? eventId : null;
}

export function usePersonEntityEvents(enabled = true): void {
  const queryClient = useQueryClient();
  const seenRef = useRef<Set<string>>(new Set());
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refreshPersonData = useCallback(() => {
    if (refreshTimerRef.current) return;
    refreshTimerRef.current = setTimeout(() => {
      refreshTimerRef.current = null;
      api.photo.getPhotoFaces.invalidate(queryClient);
      api.photo.listPersons.invalidate(queryClient);
      api.photo.personPhotos.invalidate(queryClient);
    }, 80);
  }, [queryClient]);

  useAppEntityEvents({
    appId: "person",
    kind: "person",
    enabled,
    onEvent: (event) => {
      const eventId = eventIdOf(event);
      if (eventId) {
        const seen = seenRef.current;
        if (seen.has(eventId)) return;
        seen.add(eventId);
        if (seen.size > 256) {
          const first = seen.values().next().value;
          if (typeof first === "string") seen.delete(first);
        }
      }
      refreshPersonData();
    },
  });

  useEffect(() => {
    return () => {
      if (refreshTimerRef.current) {
        clearTimeout(refreshTimerRef.current);
        refreshTimerRef.current = null;
      }
    };
  }, []);
}
