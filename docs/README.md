# RailMeet documentation

Design docs organized by system structure — not delivery phases.

| Doc                                                              | Contents                                               |
| ---------------------------------------------------------------- | ------------------------------------------------------ |
| [architecture.md](./architecture.md)                             | Monorepo layout, packages, services, runtime lifecycle |
| [domain.md](./domain.md)                                         | Places, participants, time semantics, validation       |
| [persistence-and-api.md](./persistence-and-api.md)               | Database, outbox, HTTP contracts, errors, testing      |
| [outbox-dispatch.md](./outbox-dispatch.md)                       | Lease/claim, BullMQ publish, retry, worker lifecycle   |
| [search-kickoff-and-routing.md](./search-kickoff-and-routing.md) | Kickoff consumer, retention, Transitous policy         |

Day-to-day setup, env vars, and commands live in the root [README](../README.md).
