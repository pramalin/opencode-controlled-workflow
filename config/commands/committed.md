---
description: Verify post-commit state and provide scoped bundle cleanup command
agent: committed-workflow
subtask: false
---

The user reports that the intended commit succeeded.

Completed work label, if supplied: `$ARGUMENTS`

Use the same stable work label used by the bundles. If no argument is provided,
infer it only when unambiguous from this conversation.

1. Call `git_inspect` with `status`.
2. Call `git_inspect` with `recent_log`.
3. Summarize the apparent post-commit state.
4. If remaining working-tree changes exist, distinguish unrelated work from
   files that may still belong to the completed change. Do not assume all
   remaining changes are safe to ignore.
5. Call `bundle_cleanup_info` for the completed work label.
6. Provide the returned cleanup command, but NEVER execute it.

Tell the user to run cleanup only after confirming:
- the intended commit succeeded;
- no uncommitted files from this completed change still need the bundles;
- the bundles are no longer needed for review/troubleshooting.

Cleanup must be scoped to this work label only. Never suggest deleting the
entire bundle root.
