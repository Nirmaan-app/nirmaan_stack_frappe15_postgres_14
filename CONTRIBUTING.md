# Contributing

This repo is private. Everyone who changes it follows the same five steps, whatever their role.

## Steps

1. **Get a copy, with the main repo as the remote `upstream`.** The owner clones the main repo under that name:
   `git clone -o upstream https://github.com/Nirmaan-app/nirmaan_stack_frappe15_postgres_14.git` (in a clone whose
   main-repo remote is `origin`: `git remote rename origin upstream`). Everyone else, Nitesh (`nirmaan-techadmin`),
   Madhubalan (`madhubalan17js`) and Nirupama (`Niru9196`), has the **Triage** role on the main repo: they can read it, fork it, and open,
   label and review issues and PRs, but cannot push to it. They fork it (the fork is private too), clone the fork,
   and add the main repo as `upstream`:
   `git remote add upstream https://github.com/Nirmaan-app/nirmaan_stack_frappe15_postgres_14.git`
2. **Branch from the newest `develop`.** `git fetch upstream && git switch -c <name> upstream/develop`. Name the
   branch `<issue>-<short-name>` when the work has an issue, and `<short-name>` when it doesn't.
3. **Publish the branch and open a PR into `develop` on the day you start**, as a draft if it isn't ready. The owner
   publishes the branch to the main repo with `git push -u upstream <name>`; everyone else publishes it to their
   private fork with `git push -u origin <name>`. An open PR is how the team sees what you are working on. Work that
   sits only on your machine or in a fork stays hidden.
4. **Link an issue.** If the work came from an issue, write `Closes #<issue>` in the PR description. If it didn't, a
   bot opens an issue from your PR, assigns it to you, labels it `auto-tracked`, and adds the `Closes` line.
   Merging the PR closes the issue, so don't close issues by hand.
5. **Review and merge.** The owner reviews each PR and merges it into `develop`. A release is a PR from `develop`
   into `main`. A tag on `main` then builds the production image.

## Rules

- Never push to `main` or `develop` directly. Every change arrives through a PR from its own branch.
- The owner keeps every other collaborator at Triage (Settings, Collaborators and teams). A Write or Admin role lets
  a branch skip the fork, and `scripts/private_repo_check.sh --expect private` fails on it.
- Never push to a fork that is still public. A branch pushed there is public.
- Keep secrets (keys, passwords, tokens) out of the repo, its history and its PR descriptions.

## Moving off an old public fork

Forks made before the repo went private stay public, and GitHub can't make them private. Move your checkout to a
new private fork once, from your checkout. Both commands print what they would do until you add `--apply`:

```bash
bash scripts/fork_swap.sh prepare <your-github-login> --apply    # forks the private repo as <login>/<repo>-private
bash scripts/fork_swap.sh swap --new <url it prints> --apply     # moves every branch there and checks each
```

`swap` keeps every local branch and every branch found only on the old fork, and blocks pushes to the old fork. It
asks the new fork for each branch and prints one PASS or FAIL line per branch. Tags are not moved.

Run `swap` in every clone on every machine you use. When each one ends with `0 failed`, open your PRs again from the
new fork and delete the old public fork: `gh auth refresh -s delete_repo && gh repo delete <login>/<repo>`.
