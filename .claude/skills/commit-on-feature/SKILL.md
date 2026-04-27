---
name: commit-on-feature
description: After a feature is implemented and verified working, stage the relevant changes and create a git commit. Use whenever the user confirms a feature works, tests pass, or a discrete unit of work is complete.
---

# Commit on working feature

When a feature is complete and verified working, create a git commit so progress is preserved.

## When to commit

Trigger a commit when **any** of these are true:
- The user says the feature works (e.g. "it works", "looks good", "ship it", "perfect").
- Tests pass for the new/changed code.
- A discrete unit of work in the current task is finished and the working tree is in a coherent state.

Do **not** commit when:
- The user has not confirmed the change works and you have not verified it yourself.
- The working tree contains unrelated half-finished work — commit only the feature's files.
- The user has explicitly asked you not to commit.

## How to commit

1. Run `git status` and `git diff` to see what changed.
2. Run `git log --oneline -5` to match the repo's commit message style.
3. Stage **only** the files that belong to the completed feature — never `git add -A` or `git add .` blindly. Skip secrets, unrelated edits, and large generated artifacts.
4. Write a concise message focused on *why* the change was made, not a file-by-file recap.
5. Commit with a HEREDOC so multi-line messages format correctly:

   ```
   git commit -m "$(cat <<'EOF'
   <subject line, ~50 chars, imperative mood>

   <optional body explaining motivation>

   Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
   EOF
   )"
   ```

6. Run `git status` after the commit to confirm it landed cleanly.

## On hook failure

If a pre-commit hook fails, the commit did **not** happen. Fix the underlying issue, re-stage, and create a **new** commit. Never `--amend` to "recover" — that would modify the previous commit.

## Do not

- Push to a remote unless the user asks.
- Use `--no-verify` to bypass hooks.
- Commit `.env`, credentials, or files matching `.gitignore` patterns.
- Amend or force-push without explicit user instruction.
