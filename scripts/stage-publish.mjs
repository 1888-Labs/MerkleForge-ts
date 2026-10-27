// Stages every public package at its current version with `npm stage publish`.
// Nothing goes live until a maintainer approves each staged package with 2FA
// (`npm stage approve <id>` or the Staged Packages tab on npmjs.com).
// Authentication is npm trusted publishing (OIDC) from release.yml; there is no token.
// Usage: node scripts/stage-publish.mjs [--tag <dist-tag>] [--dry-run]
// Skips versions already on npm, and everything when the vX.Y.Z GitHub release
// exists (it is created right after staging, so a re-run does not stage twice).
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const tagAt = args.indexOf('--tag')
const tag = tagAt === -1 ? 'latest' : args[tagAt + 1]

const packages = readdirSync('packages')
  .map((dir) => `packages/${dir}`)
  .filter((dir) => existsSync(`${dir}/package.json`))
  .map((dir) => ({ dir, ...JSON.parse(readFileSync(`${dir}/package.json`, 'utf8')) }))
  .filter((pkg) => !pkg.private)

const run = (cmd, argv, options = {}) =>
  execFileSync(cmd, argv, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'], ...options })

const { version } = packages.find((pkg) => pkg.name === '@merkleforge/core')
try {
  run('gh', ['release', 'view', `v${version}`], { stdio: 'ignore' })
  console.log(`v${version} already has a GitHub release; nothing to stage`)
  process.exit(0)
} catch {}

const live = (name, version) => {
  try {
    // A missing version is the normal case; keep npm's 404 out of the log.
    return (
      run('npm', ['view', `${name}@${version}`, 'version'], {
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim() === version
    )
  } catch {
    return false
  }
}

const out = mkdtempSync(join(tmpdir(), 'merkleforge-stage-'))
for (const pkg of packages) {
  if (live(pkg.name, pkg.version)) {
    console.log(`${pkg.name}@${pkg.version} is already published`)
    continue
  }
  // pnpm pack turns `workspace:^` ranges into real versions; npm would not.
  const packed = JSON.parse(
    run('pnpm', ['pack', '--json', '--pack-destination', out], { cwd: pkg.dir }),
  )
  const tarball = Array.isArray(packed) ? packed[0].filename : packed.filename
  const argv = ['stage', 'publish', tarball, '--tag', tag, '--access', 'public']
  if (dryRun) argv.push('--dry-run')
  console.log(`Staging ${pkg.name}@${pkg.version} under ${tag}`)
  run('npm', argv, { stdio: 'inherit' })
}
