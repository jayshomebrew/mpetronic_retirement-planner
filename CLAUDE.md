# Project Rules

These rules apply to all work on this code base.

- Never ever use latex markup in any outputs you generate for me to read in prompt responses, commits, or implementation plans.

- Always run a linter to check for warnings after making code changes

- Never use magic numbers in code for any stuatory values related to tax codes or thresholds. Define them using constants that convey the meaning of the value.

# Workflows

Project skills live in `.claude/skills/`: `bulk-expense`, `commit`, `deploy`, `grill-me`, `rebase`. Use them when I ask for the matching task (for example, follow the `commit` skill for every commit and the `rebase` skill for every rebase).
