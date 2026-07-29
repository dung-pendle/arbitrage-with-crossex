# Gate CrossEx fixtures (handcrafted)

Raw **snake_case** JSON bodies as Gate's API returns them at the HTTP seam —
the `gate-api` SDK deserializes these into camelCase model objects, so tests
that mock with nock MUST use this raw shape (never camelCase).

All numeric fields are decimal strings, matching Gate's wire format.

These files are handcrafted approximations and are intended to be superseded by
output recorded against the live API by the live suite.
