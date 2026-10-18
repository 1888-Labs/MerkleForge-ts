// Creates one GitHub release, tagged vX.Y.Z, for the version the packages were
// just published at. The packages share a fixed version, so the notes merge
// their CHANGELOG entries and drop duplicates.
// Usage: node scripts/github-release.mjs [--prerelease] [--target <sha>] [--dry-run]
// Needs the `gh` CLI with GH_TOKEN set. Does nothing if the release exists.
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'

const args = process.argv.slice(2)
const prerelease = args.includes('--prerelease')
const dryRun = args.includes('--dry-run')
const targetAt = args.indexOf('--target')
const target = targetAt === -1 ? process.env.GITHUB_SHA : args[targetAt + 1]

const packages = readdirSync('packages')
  .map((dir) => `packages/${dir}`)
  .filter((dir) => existsSync(`${dir}/package.json`))
  .map((dir) => ({ dir, ...JSON.parse(readFileSync(`${dir}/package.json`, 'utf8')) }))
  .filter((pkg) => !pkg.private)

const { version } = packages.find((pkg) => pkg.name === '@merkleforge/core')
const tag = `v${version}`

const gh = (...argv) =>
  execFileSync('gh', argv, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
try {
  gh('release', 'view', tag)
  console.log(`${tag} already exists`)
  process.exit(0)
} catch {}

// Collect the "### Minor Changes" style groups from each package's section
// for this version, keeping each entry once.
const groups = new Map()
for (const { dir } of packages) {
  const path = `${dir}/CHANGELOG.md`
  if (!existsSync(path)) continue
  const section = readFileSync(path, 'utf8')
    .split(/^## /m)
    .find((s) => s.startsWith(`${version}\n`))
  if (!section) continue
  for (const block of section.split(/^### /m).slice(1)) {
    const [heading, ...lines] = block.split('\n')
    const entries = lines
      .join('\n')
      .split(/^- /m)
      .map((entry) => entry.trim().replace(/^[0-9a-f]{7,40}: /, ''))
      .filter((entry) => entry && !entry.startsWith('Updated dependencies'))
    const seen = groups.get(heading) ?? new Set()
    for (const entry of entries) seen.add(entry)
    groups.set(heading, seen)
  }
}

const changes = [...groups]
  .filter(([, entries]) => entries.size > 0)
  .map(([heading, entries]) => `### ${heading}\n\n${[...entries].map((e) => `- ${e}`).join('\n')}`)
  .join('\n\n')

const npmTag = prerelease ? '@next' : ''
const notes = [
  changes || `Snapshot of \`develop\` at ${target?.slice(0, 7) ?? 'HEAD'}.`,
  '### Packages',
  packages
    .map(
      ({ name }) =>
        `- [\`${name}@${version}\`](https://www.npmjs.com/package/${name}/v/${version})`,
    )
    .join('\n'),
  `\`\`\`sh\nnpm i @merkleforge/variants${npmTag} @merkleforge/hash${npmTag} @merkleforge/core${npmTag}\n\`\`\``,
].join('\n\n')

const argv = ['release', 'create', tag, '--title', tag, '--notes', notes]
if (target) argv.push('--target', target)
if (prerelease) argv.push('--prerelease')
else argv.push('--latest')
if (dryRun) console.log(`${tag}${prerelease ? ' (prerelease)' : ''}\n\n${notes}`)
else console.log(gh(...argv).trim())
