# Releasing

The CLI in `cli/` is published to npm as [`agentboard`](https://www.npmjs.com/package/agentboard) by [the release workflow](.github/workflows/release.yml) when a `cli-v*` tag is pushed. The web app isn't published anywhere; self-hosters deploy it from `main`.

## Cutting a release

1. Bump the version in a PR and merge it:

   ```bash
   npm version 0.10.0 --prefix cli --no-git-tag-version   # or patch / minor / major
   ```

2. Tag the merge commit on `main` and push the tag:

   ```bash
   git switch main && git pull
   git tag cli-v0.10.0
   git push origin cli-v0.10.0
   ```

The workflow then:

1. runs the full CI job (typecheck, lint, tests on Postgres, build, packed CLI smoke test);
2. checks that the tag matches `cli/package.json` and that the tagged commit is on `main`;
3. packs the CLI, installs the tarball into an empty project and runs `agentboard --version` and `--help`;
4. publishes to npm with [provenance](https://docs.npmjs.com/generating-provenance-statements);
5. creates a GitHub release titled "CLI v0.10.0", with notes generated from the PRs since the previous stable `cli-v*` tag.

If any check fails, nothing is published. Fix it, delete the tag (`git push --delete origin cli-v0.10.0 && git tag -d cli-v0.10.0`) and tag again.

If the run fails after the checks (a network error while publishing or creating the release), re-run the failed jobs from the Actions tab. A version already on npm isn't published again, and an existing GitHub release is left alone.

### Dry run

Run the **Release** workflow by hand from the Actions tab (any branch). It runs every check and `npm publish --dry-run` against the current `cli/package.json` version, and creates nothing.

### npm dist-tags

| Version | Published as |
|---|---|
| Stable, above the current `latest` | `latest`, what `npm install -g agentboard` gets |
| Prerelease, e.g. `cli-v1.0.0-beta.1` | `next`, and marked as a prerelease on GitHub |
| Stable, below the current `latest` (a fix to an older line) | `maintenance`, so it doesn't replace `latest` |

The rules live in [`scripts/cli-release.mjs`](scripts/cli-release.mjs) and are tested in `test/cli-release.test.mjs`.

## One-time setup

The `agentboard` package already exists on npm, so the workflow can publish with [trusted publishing](https://docs.npmjs.com/trusted-publishers) and no stored token:

- On npmjs.com, open the `agentboard` package → **Settings** → **Trusted publishing**, choose **GitHub Actions** and enter organization `stratuslabs`, repository `agentboard`, workflow `release.yml` (leave environment empty).

Alternatively, add a granular npm access token with read and write access to `agentboard` as an Actions secret named `NPM_TOKEN`. The workflow passes it through, and npm uses trusted publishing instead whenever that's configured.

