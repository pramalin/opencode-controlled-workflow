---
description: Finalize tested changes with docs and commit commands
agent: finalize-workflow
subtask: false
---

The user reports that the implementation has passed testing and is ready for
finalization.

Work label, if supplied: `$ARGUMENTS`

Use the same stable work label used by the implementation bundles. If the
argument is empty, infer it from the current conversation/bundles only when
unambiguous.

FINALIZE IN ONE PASS:

1. Treat CURRENT `/root/repo` as authoritative. Do not rely on the original proposal.
2. Call `git_inspect` for:
   - `status`
   - `name_status`
   - `diff`
   - `recent_log`
3. Identify the files that belong to this logical change. Do not include
   unrelated working-tree changes.
4. Re-read the changed/new files from `/root/repo` as needed to understand the final
   tested implementation.
5. Inspect the project's existing documentation that could be affected.
6. Decide whether documentation updates are materially required.

If documentation changes ARE required:
- call `bundle_begin` with the same work label and phase `finalize`;
- write COMPLETE updated documentation files with `bundle_write`;
- record any rare documentation deletion/rename with the appropriate bundle tool;
- call `bundle_complete`;
- do not modify `/root/repo`.

If documentation changes are NOT required:
- do not create an empty bundle.

Then provide, in the same response:

A. Final implementation summary.
B. Documentation decision and, if applicable, final bundle ID + apply command.
C. Exact list of files that belong to this commit, including:
   - implementation files already present in `/root/repo`;
   - new/deleted/renamed files;
   - documentation files from the final bundle, if any.
D. An explicit `git add -- ...` command listing ONLY those paths.
   Never use `git add .` or `git add -A`.
E. An appropriate `git commit` command and message, guided by `recent_log`.
F. Any remaining assumptions or review points.

If a documentation bundle was generated, include this sentence prominently:

"The staging list and commit message below assume the final documentation
bundle is applied unchanged."

Never execute rsync, git add, git commit, git push, tests, builds, or shell
commands. The user performs them manually.
Do not provide bundle cleanup instructions; those belong to `/committed`.
