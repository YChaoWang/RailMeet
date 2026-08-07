# @railmeet/validation

Shared Zod schemas for RailMeet system boundaries (API request/response DTOs).

## Ownership

- Finite enums and limits live in `@railmeet/shared` (single source of truth).
- This package composes those constants into Zod schemas and infers DTO types.
- Domain types in `@railmeet/shared` are not required to match DTO shapes 1:1.

## Normalization

Strings for IDs, names, labels, dates, times, and country codes are trimmed.
Semantically invalid values are rejected — not silently repaired.
