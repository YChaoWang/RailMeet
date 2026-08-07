# @railmeet/shared

Framework-independent domain vocabulary for RailMeet.

## Contents

- Finite-value constants (`RANKING_MODES`, `TRANSPORT_MODES`, `SEARCH_STATUSES`, `API_ERROR_CODES`)
- Named input limits
- Domain types: `PlaceReference`, `Participant`, `SearchConstraints`, `SearchRequest`
- Pure calendar-date and local-time helpers

This package must not import Zod, Fastify, Next.js, BullMQ, Redis, Drizzle, or HTTP clients.
