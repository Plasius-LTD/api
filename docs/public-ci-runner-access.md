# Public CI Runner Access

The public `Plasius-LTD/api` repository runs CI only through the organization
runner group named `Public CI - Quarantined`. Package publication remains on
GitHub-hosted runners in the protected `production` environment.

## Required Group Contract

The runner group must retain all of these controls:

- visibility is `selected`;
- public repositories are allowed;
- workflow restriction is enabled;
- `Plasius-LTD/api` is in the selected-repository inventory;
- `Plasius-LTD/api/.github/workflows/ci.yml@refs/heads/main` is in the
  selected-workflow inventory.

Runners serving the workflow need the `self-hosted`, `Linux`, and `X64`
labels. Do not grant a public pull-request workflow access to this group.

## Verification

Inspect the group without changing it:

```bash
gh api orgs/Plasius-LTD/actions/runner-groups \
  --jq '.runner_groups[] | select(.name == "Public CI - Quarantined")'
```

Use the returned group id to verify its repositories and runners:

```bash
gh api "orgs/Plasius-LTD/actions/runner-groups/<group-id>/repositories"
gh api "orgs/Plasius-LTD/actions/runner-groups/<group-id>/runners"
```

After changing repository eligibility, start a new `CI` run from `main`.
Re-running a workflow created before the access correction can retain stale
runner eligibility. The workflow supports `workflow_dispatch` for this bounded
operator retry.

## Recovery

If jobs remain queued:

1. Verify the exact repository and workflow entries above.
2. Confirm an eligible runner is `online`, not only registered.
3. Start a new manual `CI` run on `main`.
4. Keep package CD and npm publication blocked until that exact commit passes.

Do not move publication onto self-hosted runners, enable public pull-request
execution, broaden the group to all repositories, or bypass the push-CI gate.
