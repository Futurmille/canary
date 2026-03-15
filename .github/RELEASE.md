# How to publish a new version

## Steps

1. **Update version** in `package.json`
   ```bash
   # patch: 1.0.0 → 1.0.1 (bug fixes)
   npm version patch --no-git-tag-version

   # minor: 1.0.0 → 1.1.0 (new features, backward compatible)
   npm version minor --no-git-tag-version

   # major: 1.0.0 → 2.0.0 (breaking changes)
   npm version major --no-git-tag-version
   ```

2. **Update CHANGELOG.md** with the new version's changes

3. **Commit and push**
   ```bash
   git add package.json CHANGELOG.md
   git commit -m "chore: bump version to X.Y.Z"
   git push
   ```

4. **Create a GitHub Release**
   - Go to https://github.com/ebutrera9103/canary/releases/new
   - Tag: `vX.Y.Z` (must match package.json version, e.g., `v1.0.0`)
   - Title: `vX.Y.Z`
   - Description: copy the relevant section from CHANGELOG.md
   - Click "Publish release"

5. **GitHub Actions will automatically**:
   - Run tests on Node.js 20
   - Verify the tag matches package.json version
   - Build the TypeScript
   - Publish to npm as `@futurmille/canary`

## First-time setup

You need to add an `NPM_TOKEN` secret to the GitHub repository:

1. Go to https://www.npmjs.com/settings/futurmille/tokens
2. Create a new **Automation** token (or Granular Access token with publish permissions)
3. Go to https://github.com/ebutrera9103/canary/settings/secrets/actions
4. Click "New repository secret"
5. Name: `NPM_TOKEN`
6. Value: paste the token from step 2
