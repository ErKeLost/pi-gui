import { readFile, writeFile } from 'node:fs/promises'

const root = new URL('..', import.meta.url)
const pkg = JSON.parse(await readFile(new URL('package.json', root), 'utf8'))
const groups = ['dependencies', 'devDependencies']
const names = groups.flatMap(group => Object.keys(pkg[group] ?? {}))
const js = []
for (const name of names) {
  const source = `https://registry.npmjs.org/${encodeURIComponent(name)}/latest`
  const response = await fetch(source)
  if (!response.ok) throw new Error(`${name}: ${response.status}`)
  const latest = (await response.json()).version
  const installed = pkg.dependencies?.[name] ?? pkg.devDependencies?.[name]
  const lockSpec = String(installed).replace(/^[~^<>= ]+/, '')
  js.push({ name, installed: lockSpec, latest, matches: lockSpec === latest, source })
}
const data = {
  checkedAt: new Date().toISOString(),
  packageManager: pkg.packageManager,
  js,
  rust: JSON.parse(await readFile(new URL('docs/versions.json', root), 'utf8')).rust,
}
await writeFile(new URL('docs/versions.json', root), `${JSON.stringify(data, null, 2)}\n`)
console.log(`checked ${js.length} npm packages`)
