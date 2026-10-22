# Security and data boundaries

This project is a single-user local workbench, not a hardened multi-tenant hosting service.

- Start it through `server.mjs` / the supplied npm commands. The custom server sets the peer-address header used for local access checks; do not expose raw Next.js handlers behind an unreviewed proxy.
- Default binding is loopback. LAN pairing is opt-in and intended for a trusted network. Do not expose the working material library on the public Internet.
- Media, transcripts, review notes, user word lists, authentication state and SQLite databases are runtime data. They must never be committed.
- Local storage is not encrypted by this Web app. Protect the device and backups appropriately.
- `/demo` uses only synthetic text and browser computation. Full AI workflows send selected text to the configured provider, after the interface explains the operation. Review provider data handling before using sensitive material.
- API keys belong in local environment files or a controlled server environment. `.env.example` contains blank placeholders only.
- Public checks inspect staged files and reachable commit history for forbidden data paths, media/database files, private paths and common credential formats. These checks do not replace manual review.

For a vulnerability, contact the repository maintainer privately where possible. Do not attach private recordings, tokens, transcripts or database dumps to a public issue.
