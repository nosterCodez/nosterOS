# Synthetic places fixture

`places.parquet` contains two invented businesses, not downloaded Foursquare data.
One is inside the test bounding box and one outside. Regenerate with
`node tests/fixtures/places/generate-fixture.cjs` (no network or dependencies).
The small test-only encoder writes required, uncompressed PLAIN columns.
Production imports use the approved MIT hyparquet reader, not this encoder.
No portal account, data-access terms, mirrors or Hugging Face consent was used.
