# Claude GSD Compatibility Entrypoint

This file exists because GSD 1.7 resolves Claude project instructions to `.claude/CLAUDE.md`.

- Read `../AGENTS.md` first when it exists; it is the maintainer-owned boot contract.
- Follow the workflow entrypoints in `../AGENTS.md`; read the linked PR/CI or release runbook only when the selected workflow calls for it.
- This compatibility shim grants no GitHub, production, migration, runtime, Tunnel, smoke, merge, tag, or destructive authority.

If the referenced boot contract is unavailable, fail closed for GSD mutation and ask the maintainer for the current project instructions.
