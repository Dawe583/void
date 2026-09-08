# Swarm state

One line per track, updated by the track owner. Read before you start and after every land.
Parent sweeps this file into commit messages.

## Tracks

| track | owner | status | depends on |
| ----- | ----- | ------ | ---------- |
| postgres connector | pg-connector | landed parse, capture, inverse, replay, classify with scoped tests passing | snapshot-store put/get shapes |
| snapshot store | snapshot-store | landed snapshot store files, snapshot tests pass, package typecheck blocked by sibling postgres tests | nothing |
| s3 connector | s3-connector | landed S3 classify, capture, inverse, apply and tests; own tests pass, package typecheck blocked by sibling postgres test syntax | snapshot-store shapes |
| void replay cli | replay-cli | landed replay command, manifest digest lookup, fake connector tests and bin wiring; verification passed locally | connector interface from README |
| blast radius probes | probes | landed probe registry, Postgres, S3 and cache; own tests pass, package verify blocked by sibling files | connector interfaces |

## Rules

1. Update your row (status + one sentence) before you end each work session.
2. Message a sibling directly when you land a file they depend on.
3. The contract in packages/connectors/README.md is frozen: if you must change a shape,
   message the parent AND every sibling in this table, and update the README in your commit.
4. Never edit another track's files. The paths are yours alone.
