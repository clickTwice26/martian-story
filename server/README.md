# jezero-server

Static file server for the Jezero client. Go, stdlib only, no modules.

The game is a pure client-side application and needs **no backend** — it deploys
to any static host as-is. This exists only because browsers refuse ES modules and
`fetch()` on a `file://` origin, so something has to speak HTTP locally.

It replaces `python3 -m http.server`, which fails this project in three ways:

| | python3 -m http.server | jezero-server |
|---|---|---|
| `Range:` on a 23 MB heightmap | `200`, sends all 23,915,936 bytes | `206`, sends the 100 requested |
| gzip on 1.7 MB traverse GeoJSON | none | 495,201 bytes (3.5×) |
| `.glb` content type | depends on the host's mime table | always `model/gltf-binary` |

Range support is not cosmetic: it is how a client reads part of a large asset
without pulling all of it, and it is the same mechanism `tools/extract_dtm.py`
uses to pull 285 MB out of a 1.84 GB USGS GeoTIFF.

## Build and run

```bash
cd server && go build -o jezero-server .
./jezero-server -dir .. -port 8123
```

Flags: `-dir` (root), `-port`, `-host` (default `127.0.0.1`), `-v` (request log).

## Behaviour

- gzip for text types over 1 KB; never for png/glb/woff/zip, and never alongside
  a `Range` request (a byte offset into a gzip stream is meaningless to the client)
- `Cache-Control: immutable` for `data/` and `vendor/`, `no-cache` for source
- `Range`, `If-Modified-Since` and `ETag` via `http.ServeContent`
- paths resolved inside the root; traversal returns 404
- `X-Content-Type-Options: nosniff`, graceful shutdown on SIGINT
