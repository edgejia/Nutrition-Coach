# Claude GSD Compatibility Entrypoint

This file exists because GSD 1.7 resolves Claude project instructions to `.claude/CLAUDE.md`.

- Read `../AGENTS.md` first when it exists; it is the maintainer-owned boot contract.
- Follow `../docs/codex.md` only when that local routing document exists and the selected workflow calls for it.
- If the boot contract declares a Temporary GSD Maintenance Pause, do not route, plan, execute, verify, ship, close out, repair, or otherwise mutate `.planning/**` until the maintainer explicitly lifts it in the current thread.
- Never infer the actual writer runtime from shared `.planning/config.json`; runtime provenance must come from the active workflow lease.
- This compatibility shim grants no GitHub, production, migration, runtime, Tunnel, smoke, merge, tag, or destructive authority.

If the referenced boot contract is unavailable, fail closed for GSD mutation and ask the maintainer for the current project instructions.
