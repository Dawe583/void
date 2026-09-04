# @void/connectors

One connector per tool surface. Each knows how to snapshot the state a call is
about to change, and how to build the inverse of that call.

## Responsible for

The half of the product that is not the hold: proving the undo. A connector
answers for a surface (`postgres.row`, `aws.s3.object`), takes a keyed before
image where one exists, and produces the call that reverses the change. It stores
references and digests, never payloads.

Postgres is WP-06 and is the first, against a local, non production database. S3
is WP-07. Nothing here is implemented yet.

## Must never import

Another connector. Nothing may fan out across surfaces, because then one
classification bug is spread across surfaces with different auth, snapshot
formats and failure modes.

Also not the proxy: resolution goes the other way, the proxy is handed a list and
looks up an id.

## Must never do

Hold its own standing credentials for probing. A connector uses the upstream MCP
server's own tools; giving VOID read only access to every customer system turns a
proxy into an agent platform and a much longer security review. Preconditions come
from declared configuration until that changes deliberately, at phase 6.

Run a test against anything a customer could see. Every connector's tests run
against a local or disposable target.

## Public surface

- `ConnectorId`, `Connector`
- `findConnector(available, id)`, `assertUniqueIds(available)`

Both take the available list as a parameter, so this package never imports a
concrete connector and the proxy's wiring is visible at its call site.
