# tokimo-app-photo

Standalone photo library management sidecar for Tokimo.

## Features
- Photo library CRUD with VFS-based sources
- Timeline / folder / album / favorites / trash views
- Person (face) management
- Geographic tagging
- AI-powered OCR, CLIP semantic search, and face recognition (via perception worker)

## Development

```bash
# Build Rust binary
cargo build -p tokimo-app-photo

# Build UI
cd ui && pnpm install && pnpm build

# Run clippy
cargo clippy --bins -- -D warnings
```
