---
description: Create the next complete-file implementation bundle
agent: prepare-workflow
subtask: false
---

Prepare the next implementation bundle for the current change.

Requested work label, if supplied: `$ARGUMENTS`

Use the same stable work label for every iteration of the same logical change.
If `$ARGUMENTS` is empty and an earlier bundle for this change was already
created in this conversation, reuse that work label. Otherwise derive a short,
specific work label from the current task.

Before creating anything:

1. Re-read the CURRENT `/root/repo` versions of every file relevant to the proposed
   change. The filesystem is authoritative.
2. Re-check relevant usages, tests, interfaces, and conventions.
3. Do not rely on source text remembered from an earlier discussion or bundle.
4. Make sure the implementation reflects the latest design agreed with the user.
5. Do not build, test, run Git, or execute shell commands.

Then:

1. Call `bundle_begin` with phase `implementation`.
2. For every modified or new file, call `bundle_write` with the COMPLETE
   resulting file and repository-relative path.
3. For a deletion, call `bundle_remove`.
4. For a rename, call `bundle_rename` and provide the COMPLETE destination file.
5. Do not include unchanged files.
6. Call `bundle_complete`.

In your response report:
- bundle ID;
- modified/new/renamed/deleted files;
- concise rationale;
- assumptions or risks;
- the exact rsync/apply command returned by the bundle tool;
- any manual deletion/rename steps.

Do not use `rsync --delete`.
Do not provide a bundle cleanup command at this stage.
Stop after presenting the bundle. The user will inspect, apply, build, and test.
