import type { FieldPacket, FieldPacketDoor } from "@/lib/canvass/packet";
import { orderForStreetWalk, type Point } from "@/lib/canvass/walk-order";

/** Rebase a downloaded packet's street-first route on the volunteer's live position. */
export function orderFieldPacketFrom(packet: FieldPacket, start: Point): FieldPacket {
  const doors = orderForStreetWalk(packet.doors, {
    pointOf: (door) =>
      door.lat != null && door.lng != null
        ? { lat: door.lat, lng: door.lng }
        : null,
    addressOf: (door) => ({
      addressLine: door.addressLine,
      city: door.city,
      unit: door.unit,
    }),
    start,
  }).map(
    (door, sortOrder): FieldPacketDoor => ({
      ...door,
      sortOrder,
    }),
  );

  return { ...packet, doors };
}
