/**
 * Build the single-file `dsh` executable the Tauri desktop shell bundles
 * (`@yao-pkg/pkg --sea`, the route owned by
 * .agents/notes/implemented/architecture/2026-07-10-single-file-executable-sdk-runtime-distribution.md).
 * The staged closure carries the dsh CLI, its full web profile closure, and
 * the built frontend dist; products land in `desktop/src-tauri/resources/`
 * for the app bundle and in `dist-exe/` for inspection.
 */

import { spawn } from 'node:child_process'
import { existsSync, statSync } from 'node:fs'
import { chmod, copyFile, cp, lstat, mkdir, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve, sep } from 'node:path'
import { parseArgs } from 'node:util'

const root = resolve(import.meta.dirname, '..')

/** The closure manifest whose dependencies define the executable. */
const DEPLOY_ROOT_PACKAGE = 'dsh-desktop-pkg'
/** The manifest the closure verifier checks. */
const RUNTIME_MANIFEST = 'desktop/runtime/package.json'
/** The closed-runtime app entry inside the deployed closure (the published dsh bin). */
const ENTRY_BIN = 'node_modules/@deepseek-ai/dsh/lib/bin.js'
/** Deploy staging (pkg input); cleared per run. */
const STAGING_DIR = 'dist-exe/dsh-desktop-node'
/** Legacy deploy hoists direct packages beside the deploy source; restore from here. */
const DEPLOY_SOURCE_NODE_MODULES = 'desktop/runtime/node_modules'
/** Products for the Tauri app bundle (tauri.conf.json `bundle.resources`). */
const RESOURCES_DIR = 'desktop/src-tauri/resources'
/** Inspection copies with per-target names. */
const OUT_DIR = 'dist-exe'
/** Default Node major; SEA mode requires at least Node 22. */
const DEFAULT_NODE_RANGE = 'node24'
/** Pinned for reproducible builds. */
const PKG_SPEC = '@yao-pkg/pkg@6.21.0'
/** The npm registry override: `pnpm dlx` must not consult a local mirror. */
const REGISTRY = 'https://registry.npmjs.org/'

/**
 * Whole-tree assets cover Cordis's runtime bare-package imports, which pkg's
 * static analysis cannot see, plus the browser surface the dsh web runtime
 * serves from inside the VFS: the frontend dist and the shipped agent-preset
 * YAML. Package manifests are explicit because bare-name resolution depends
 * on them.
 */
const ASSET_GLOBS = [
  'package.json',
  'node_modules/**/*.js',
  'node_modules/**/*.cjs',
  'node_modules/**/*.mjs',
  'node_modules/**/package.json',
  'node_modules/**/*.json',
  'node_modules/**/*.node',
  'node_modules/**/*.dylib',
  'node_modules/**/*.wasm',
  'node_modules/**/*.html',
  'node_modules/**/*.css',
  'node_modules/**/*.svg',
  'node_modules/**/*.png',
  'node_modules/**/*.ico',
  'node_modules/**/*.webmanifest',
  'node_modules/**/*.map',
  'node_modules/**/*.yml',
  'node_modules/**/*.yaml',
  'node_modules/**/*.woff',
  'node_modules/**/*.woff2',
  'node_modules/**/*.ttf',
  'node_modules/**/*.otf',
]

/** The desktop shell is macOS-verified; other platforms are future work. */
const PLATFORMS = ['macos'] as const
const ARCHES = ['x64', 'arm64'] as const
type Platform = (typeof PLATFORMS)[number]
type Arch = (typeof ARCHES)[number]

function isPlatform(value: string): value is Platform {
  return (PLATFORMS as readonly string[]).includes(value)
}

function isArch(value: string): value is Arch {
  return (ARCHES as readonly string[]).includes(value)
}

/**
 * A parsed pkg target triple, constructed from `--targets` or the host.
 */
class Target {
  private constructor(
    /** pkg Node range (`node<major>`). */
    readonly nodeRange: string,
    /** pkg platform tag. */
    readonly platform: Platform,
    /** pkg CPU tag. */
    readonly arch: Arch,
  ) {}

  /** The pkg `--targets` spec string `<nodeRange>-<platform>-<arch>`. */
  get spec(): string {
    return `${this.nodeRange}-${this.platform}-${this.arch}`
  }

  /**
   * Parse one target spec, rejecting malformed triples and unsupported platform or architecture.
   * @param spec - the raw triple, e.g. `node24-macos-arm64`.
   * @returns the parsed target.
   */
  static parse(spec: string): Target {
    const parts = spec.split('-')
    const [nodeRange, platform, arch] = parts
    if (parts.length !== 3 || nodeRange === undefined || platform === undefined || arch === undefined) {
      throw new Error(`build-exe-for-desktop-shell: target ${JSON.stringify(spec)} must be <nodeRange>-<platform>-<arch>, e.g. node24-macos-arm64.`)
    }
    if (!/^node\d+$/.test(nodeRange)) {
      throw new Error(`build-exe-for-desktop-shell: target ${JSON.stringify(spec)}: node range must look like node24, got ${JSON.stringify(nodeRange)}.`)
    }
    if (!isPlatform(platform)) {
      throw new Error(`build-exe-for-desktop-shell: target ${JSON.stringify(spec)}: platform must be one of ${PLATFORMS.join(', ')}, got ${JSON.stringify(platform)}.`)
    }
    if (!isArch(arch)) {
      throw new Error(`build-exe-for-desktop-shell: target ${JSON.stringify(spec)}: arch must be one of ${ARCHES.join(', ')}, got ${JSON.stringify(arch)}.`)
    }
    return new Target(nodeRange, platform, arch)
  }

  /**
   * Resolve the host-platform default on Node 24.
   * @returns the host target; throws on an unsupported host platform or arch.
   */
  static host(): Target {
    const platform = process.platform === 'darwin' ? 'macos' : undefined
    if (platform === undefined) {
      throw new Error(`build-exe-for-desktop-shell: unsupported host platform ${process.platform}; pass --targets explicitly.`)
    }
    const arch = process.arch === 'x64' || process.arch === 'arm64' ? process.arch : undefined
    if (arch === undefined) {
      throw new Error(`build-exe-for-desktop-shell: unsupported host arch ${process.arch}; pass --targets explicitly.`)
    }
    return new Target(DEFAULT_NODE_RANGE, platform, arch)
  }
}

/**
 * Validated CLI configuration; construction owns help and parse-error exits.
 */
class BuildCli {
  private constructor(
    /** Build targets; defaults to the host platform only. */
    readonly targets: readonly Target[],
    /** Skip step 1 (`pnpm run build`); lib/ artifacts must already exist. */
    readonly skipBuild: boolean,
    /** Print every command and config patch instead of executing. */
    readonly dryRun: boolean,
  ) {}

  /**
   * Parse argv. Help exits 0; malformed flags exit 1; invalid or colliding
   * targets throw.
   * @param argv - the raw arguments (`process.argv.slice(2)`).
   * @returns the parsed, validated configuration.
   */
  static parse(argv: string[]): BuildCli {
    let values: ReturnType<typeof BuildCli.parseRaw>
    try {
      values = BuildCli.parseRaw(argv)
    } catch (error) {
      console.error(`build-exe-for-desktop-shell: ${error instanceof Error ? error.message : String(error)}\n`)
      console.error(BuildCli.usage())
      process.exit(1)
    }
    if (values.help) {
      console.log(BuildCli.usage())
      process.exit(0)
    }
    const targets = values.targets === undefined
      ? [Target.host()]
      : values.targets.split(',').map(part => part.trim()).filter(part => part !== '').map(spec => Target.parse(spec))
    if (targets.length === 0) throw new Error('build-exe-for-desktop-shell: --targets is empty.')
    const seen = new Set<string>()
    for (const target of targets) {
      const key = `${target.platform}-${target.arch}`
      if (seen.has(key)) {
        throw new Error(`build-exe-for-desktop-shell: duplicate platform-arch ${key} in --targets; the bundle products share one name.`)
      }
      seen.add(key)
    }
    return new BuildCli(targets, values['skip-build'], values['dry-run'])
  }

  private static parseRaw(argv: string[]) {
    return parseArgs({
      args: argv,
      options: {
        'targets': { type: 'string' },
        'skip-build': { type: 'boolean', default: false },
        'dry-run': { type: 'boolean', default: false },
        'help': { type: 'boolean', default: false },
      },
    }).values
  }

  private static usage(): string {
    return [
      'Usage: pnpm exec tsx scripts/build-exe-for-desktop-shell.ts [flags]',
      '',
      '  --targets=<t1,t2,...>  pkg targets, e.g. node24-macos-arm64,node24-macos-x64.',
      '                         Default: the host platform only (on node24).',
      '  --skip-build           skip `pnpm run build` (lib/ artifacts must already exist).',
      '  --dry-run              print every command and config patch without executing.',
      '  --help                 print this help.',
      '',
      `Build route: ${PKG_SPEC} --sea; see .agents/notes/implemented/architecture/2026-07-10-single-file-executable-sdk-runtime-distribution.md.`,
      `Stages the closure in ${STAGING_DIR} and writes the bundle products to ${RESOURCES_DIR}/.`,
    ].join('\n')
  }
}

function pnpmBin(): string {
  return process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
}

/**
 * Render a command for logs and errors, quoting arguments with spaces.
 * @param command - the executable.
 * @param args - its arguments.
 * @returns the printable command line.
 */
function formatCommand(command: string, args: string[]): string {
  return [command, ...args].map(part => (part.includes(' ') ? JSON.stringify(part) : part)).join(' ')
}

/**
 * Sequential build pipeline. Subprocesses inherit stdio and errors include
 * the command; dry runs print commands and filesystem changes.
 */
class SingleExeBuild {
  /** The cleared deploy target and pkg input. */
  readonly staging = resolve(root, STAGING_DIR)
  private readonly outDir = resolve(root, OUT_DIR)

  constructor(private readonly cli: BuildCli) {}

  /** Verify the closure before compiling or packaging. */
  async verifyClosure(): Promise<void> {
    await this.run('runtime dependency closure', pnpmBin(), [
      'exec', 'tsx', 'scripts/verify-runtime-closure.ts', '--manifest', RUNTIME_MANIFEST,
    ])
  }

  /** Build all package artifacts unless `--skip-build` was passed. */
  async build(): Promise<void> {
    if (this.cli.skipBuild) {
      console.log('build-exe-for-desktop-shell: skipping pnpm run build (--skip-build)')
      return
    }
    await this.run('build', pnpmBin(), ['run', 'build'])
  }

  /** Clear and deploy the runtime closure into the staging tree. */
  async deployStaging(): Promise<void> {
    if (this.staging === root || root.startsWith(this.staging + sep)) {
      throw new Error(`build-exe-for-desktop-shell: refusing to clear staging dir ${this.staging}: it contains the repo root.`)
    }
    if (this.cli.dryRun) console.log(`build-exe-for-desktop-shell: [dry-run] rm -rf ${this.staging}`)
    else await rm(this.staging, { recursive: true, force: true })
    await this.run('deploy', pnpmBin(), [
      '--filter',
      DEPLOY_ROOT_PACKAGE,
      'deploy',
      '--legacy',
      '--prod',
      '--config.node-linker=hoisted',
      '--config.auto-install-peers=false',
      '--config.link-workspace-packages=true',
      // The legacy deploy reuses desktop/runtime/node_modules between runs; its
      // recorded settings no longer match the fresh install, and pnpm would
      // prompt to purge it (aborting under no TTY).
      '--config.confirm-modules-purge=false',
      '--registry',
      REGISTRY,
      this.staging,
    ])
    await this.restoreLegacyHoists()
    await this.materializeStagedLinks()
    await this.adaptProfileHeal()
  }

  /**
   * Adapt the staged app-boot profile fallback for the packaged VFS.
   *
   * Node's ESM resolver follows `$DSH_HOME/profiles/node_modules` symlinks at
   * the kernel level, where `/snapshot` does not exist, so the installation
   * fallback inside the single-file exe must materialize real directories
   * instead of links. The patch replaces the heal loop with a marker-guarded
   * copy: the marker records the executable's size and mtime, so the fallback
   * is rebuilt only when the exe itself changes. The anchor strings fail the
   * build loudly when the upstream app-boot bundle drifts.
   */
  private async adaptProfileHeal(): Promise<void> {
    if (this.cli.dryRun) {
      console.log('build-exe-for-desktop-shell: [dry-run] adapt app-boot profile heal for the packaged VFS')
      return
    }
    const appBoot = join(this.staging, 'node_modules', '@deepseek-ai', 'dsh-app-boot', 'lib', 'index.js')
    // The staging tree must be materialized before patching: writing through a
    // workspace symlink would corrupt the repository source.
    const appBootStat = await lstat(appBoot)
    if (!appBootStat.isFile() || appBootStat.isSymbolicLink() || await realpath(appBoot) !== appBoot) {
      throw new Error(`build-exe-for-desktop-shell: ${appBoot} is not a materialized regular file; the deploy did not produce a link-free staging tree.`)
    }
    // A prior unsynchronized build may have written the patch through a staging
    // symlink into the repository source; refuse to bake that corruption in.
    const upstreamBoot = resolve(root, 'packages', 'boot', 'app-boot', 'lib', 'index.js')
    if ((await readFile(upstreamBoot, 'utf8')).includes('__dshDesktop')) {
      throw new Error(
        `build-exe-for-desktop-shell: ${upstreamBoot} carries a packaging patch written through a staging symlink by a concurrent build; revert it (the patch belongs in the staging tree only) and retry.`,
      )
    }
    let source = await readFile(appBoot, 'utf8')
    const importAnchor = 'import { existsSync, lstatSync, mkdirSync, readFileSync, readlinkSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";'
    const importPatch = 'import { existsSync, lstatSync, mkdirSync, readFileSync, readlinkSync, symlinkSync, unlinkSync, writeFileSync, readdirSync as __dshDesktopReaddir, rmSync as __dshDesktopRm, statSync as __dshDesktopStat } from "node:fs";'
    // Each patch is idempotent: a staging tree that already carries it (a
    // previous run's leftovers) stays valid instead of failing the anchor check.
    if (source.includes(importAnchor)) source = source.replace(importAnchor, importPatch)
    else if (!source.includes(importPatch)) {
      throw new Error(`build-exe-for-desktop-shell: app-boot fs import anchor missing at ${appBoot}; the heal adaptation drifted from upstream.`)
    }
    const loopAnchor = '\tfor (const [packageName, target] of links) {\n\t\tconst link = join(modulesDir, packageName);\n\t\tmkdirSync(dirname(link), { recursive: true });\n\t\tensureSymlink(link, target);\n\t}'
    // Materialized real directories must also cover optional platform loader
    // packages (sharp, koffi): the BFS walks dependencies and peers only.
    const bfsAnchor = '\tfor (const dep of [...Object.keys(next.manifest.dependencies ?? {}), ...Object.keys(next.manifest.peerDependencies ?? {})]) {'
    const bfsPatch = '\tfor (const dep of [...Object.keys(next.manifest.dependencies ?? {}), ...Object.keys(next.manifest.peerDependencies ?? {}), ...Object.keys(next.manifest.optionalDependencies ?? {})]) {'
    const loopPatch = `\tconst __dshDesktopCopyTree = (src, dst) => {
\t\tconst entryStat = lstatSync(src);
\t\tif (entryStat.isDirectory()) {
\t\t\tmkdirSync(dst, { recursive: true });
\t\t\tfor (const name of __dshDesktopReaddir(src)) __dshDesktopCopyTree(join(src, name), join(dst, name));
\t\t} else {
\t\t\tmkdirSync(dirname(dst), { recursive: true });
\t\t\twriteFileSync(dst, readFileSync(src));
\t\t}
\t};
\tconst markerPath = join(modulesDir, ".dsh-desktop-vfs");
\tconst executableStat = __dshDesktopStat(process.execPath);
\tconst marker = \`\${executableStat.size}:\${String(executableStat.mtimeMs)}\`;
\tlet materialized = false;
\ttry {
\t\tmaterialized = readFileSync(markerPath, "utf8") === marker;
\t} catch {
\t}
\tif (!materialized) {
\t\t__dshDesktopRm(modulesDir, { recursive: true, force: true });
\t\tmkdirSync(modulesDir, { recursive: true });
\t\tfor (const [packageName, target] of links) {
\t\t\t__dshDesktopCopyTree(target, join(modulesDir, packageName));
\t\t}
\t\twriteFileSync(markerPath, marker);
\t}`
    if (source.includes(bfsAnchor)) source = source.replace(bfsAnchor, bfsPatch)
    else if (!source.includes(bfsPatch)) {
      throw new Error(`build-exe-for-desktop-shell: app-boot heal BFS anchor missing at ${appBoot}; the heal adaptation drifted from upstream.`)
    }
    if (source.includes(loopAnchor)) source = source.replace(loopAnchor, loopPatch)
    else if (!source.includes(loopPatch)) {
      throw new Error(`build-exe-for-desktop-shell: app-boot heal loop anchor missing at ${appBoot}; the heal adaptation drifted from upstream.`)
    }
    await writeFile(appBoot, source)
    console.log(`build-exe-for-desktop-shell: adapted profile heal in ${appBoot}`)
  }

  /**
   * Restore direct packages that pnpm's legacy hoister places beside the deploy
   * source instead of in the target. The runtime manifest supplies every peer,
   * so package-local node_modules trees are omitted to preserve one flat Cordis
   * instance and a symlink-free packaged payload.
   */
  private async restoreLegacyHoists(): Promise<void> {
    if (this.cli.dryRun) {
      console.log('build-exe-for-desktop-shell: [dry-run] restore direct dependencies omitted by legacy deploy')
      return
    }
    const manifestPath = join(this.staging, 'package.json')
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as {
      dependencies?: Record<string, string>
    }
    const sourceNodeModules = resolve(root, DEPLOY_SOURCE_NODE_MODULES)
    const restored: string[] = []
    for (const dependency of Object.keys(manifest.dependencies ?? {}).sort()) {
      const destination = join(this.staging, 'node_modules', dependency)
      if (existsSync(destination)) continue
      const source = join(sourceNodeModules, dependency)
      if (!existsSync(source)) {
        throw new Error(
          `build-exe-for-desktop-shell: deployed dependency ${dependency} is absent from both ${destination} and ${source}.`,
        )
      }
      await mkdir(dirname(destination), { recursive: true })
      const nestedNodeModules = join(source, 'node_modules')
      await cp(source, destination, {
        recursive: true,
        dereference: true,
        filter: path => path !== nestedNodeModules && !path.startsWith(nestedNodeModules + sep),
      })
      restored.push(dependency)
    }
    const stillMissing = Object.keys(manifest.dependencies ?? {})
      .filter(dependency => !existsSync(join(this.staging, 'node_modules', dependency)))
    if (stillMissing.length > 0) {
      throw new Error(`build-exe-for-desktop-shell: staged dependencies remain missing: ${stillMissing.join(', ')}.`)
    }
    if (restored.length > 0) {
      console.log(`build-exe-for-desktop-shell: restored legacy deploy hoists: ${restored.join(', ')}`)
    }
  }

  /** Replace deploy-time package links with files and reject any remaining link. */
  private async materializeStagedLinks(): Promise<void> {
    if (this.cli.dryRun) {
      console.log('build-exe-for-desktop-shell: [dry-run] materialize staged package links')
      return
    }
    const nodeModules = join(this.staging, 'node_modules')
    let remaining = await this.findSymlink(nodeModules)
    while (remaining !== undefined) {
      const segments = remaining.slice(nodeModules.length + 1).split(sep)
      const binIndex = segments.lastIndexOf('.bin')
      if (binIndex >= 0) {
        await rm(join(nodeModules, ...segments.slice(0, binIndex + 1)), { recursive: true, force: true })
        remaining = await this.findSymlink(nodeModules)
        continue
      }
      const destination = remaining
      const source = await realpath(destination)
      const nestedNodeModules = join(source, 'node_modules')
      await rm(destination, { recursive: true, force: true })
      await cp(source, destination, {
        recursive: true,
        dereference: true,
        filter: path => path !== nestedNodeModules && !path.startsWith(nestedNodeModules + sep),
      })
      remaining = await this.findSymlink(nodeModules)
    }
  }

  /** Return the first symbolic link below a directory, if one exists. */
  private async findSymlink(directory: string): Promise<string | undefined> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      const metadata = await lstat(path)
      if (metadata.isSymbolicLink()) return path
      if (metadata.isDirectory()) {
        const nested = await this.findSymlink(path)
        if (nested !== undefined) return nested
      }
    }
    return undefined
  }

  /** Add the executable entry and pkg assets to the staged manifest. */
  async injectPkgConfig(): Promise<void> {
    const patch = { bin: ENTRY_BIN, pkg: { assets: ASSET_GLOBS } }
    const manifestPath = join(this.staging, 'package.json')
    if (this.cli.dryRun) {
      console.log(`build-exe-for-desktop-shell: [dry-run] patch ${manifestPath} with ${JSON.stringify(patch)}`)
      return
    }
    if (!existsSync(manifestPath)) {
      throw new Error(`build-exe-for-desktop-shell: ${manifestPath} missing — pnpm deploy did not produce a staged package.`)
    }
    if (!existsSync(join(this.staging, ENTRY_BIN))) {
      throw new Error(`build-exe-for-desktop-shell: ${join(this.staging, ENTRY_BIN)} missing — run without --skip-build so lib/ artifacts exist.`)
    }
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as Record<string, unknown>
    await writeFile(manifestPath, `${JSON.stringify({ ...manifest, ...patch }, null, 2)}\n`)
    console.log(`build-exe-for-desktop-shell: injected pkg config into ${manifestPath}`)
  }

  /**
   * Package one target; SEA mode accepts one target per invocation. The
   * product lands under the bundle resources dir with its stable name, and an
   * inspection copy keeps the per-target name.
   * @param target - the pkg target triple to build.
   * @returns the product paths written into the resources dir.
   */
  async pack(target: Target): Promise<string[]> {
    const product = join(this.outDir, '.dsh-product-tmp')
    if (this.cli.dryRun) {
      console.log(`build-exe-for-desktop-shell: [dry-run] pkg ${target.spec} -> ${product}`)
      return [product, `${product}-spawn-helper`]
    }
    await this.run(`pkg ${target.spec}`, pnpmBin(), [
      'dlx',
      PKG_SPEC,
      this.staging,
      '--sea',
      '--targets',
      target.spec,
      '--output',
      product,
    ])
    if (!existsSync(product)) {
      throw new Error(`build-exe-for-desktop-shell: product ${product} is missing after the pkg run; inspect ${this.outDir}.`)
    }
    const resourcesDir = resolve(root, RESOURCES_DIR)
    await mkdir(resourcesDir, { recursive: true })
    const exe = join(resourcesDir, 'dsh')
    const helper = join(resourcesDir, 'dsh-spawn-helper')
    await copyFile(product, exe)
    await chmod(exe, 0o755)
    const helperSource = join(this.staging, 'node_modules', 'node-pty', 'prebuilds', `darwin-${target.arch}`, 'spawn-helper')
    if (!existsSync(helperSource)) {
      throw new Error(`build-exe-for-desktop-shell: node-pty spawn-helper missing at ${helperSource}`)
    }
    await copyFile(helperSource, helper)
    await chmod(helper, 0o755)
    // Inspection copies with per-target names.
    await mkdir(this.outDir, { recursive: true })
    const exeCopy = join(this.outDir, `dsh-desktop-${target.platform}-${target.arch}`)
    const helperCopy = `${exeCopy}-spawn-helper`
    await copyFile(product, exeCopy)
    await copyFile(helperSource, helperCopy)
    await rm(product, { force: true })
    return [exe, helper]
  }

  /**
   * Print each product path and its size.
   * @param products - the product paths returned by {@link pack}.
   */
  printProducts(products: string[]): void {
    console.log(this.cli.dryRun ? 'build-exe-for-desktop-shell: [dry-run] would produce:' : 'build-exe-for-desktop-shell: products:')
    for (const path of products) {
      if (this.cli.dryRun) {
        console.log(`  ${path}`)
        continue
      }
      const megabytes = statSync(path).size / (1024 * 1024)
      console.log(`  ${path}  (${megabytes.toFixed(1)} MB)`)
    }
  }

  /**
   * Run one subprocess with inherited stdio. Spawn and non-zero-exit errors
   * include the command; dry runs only print it.
   * @param label - the step name used in logs and error messages.
   * @param command - the executable.
   * @param args - its arguments.
   */
  private async run(label: string, command: string, args: string[]): Promise<void> {
    const printable = formatCommand(command, args)
    if (this.cli.dryRun) {
      console.log(`build-exe-for-desktop-shell: [dry-run] ${printable}`)
      return
    }
    console.log(`build-exe-for-desktop-shell: ${label}: ${printable}`)
    await new Promise<void>((resolvePromise, reject) => {
      const child = spawn(command, args, {
        cwd: root,
        stdio: 'inherit',
        // Artifact builds must not mutate or validate a developer's Git hooks.
        // The registry override keeps pnpm off any locally configured mirror.
        env: { ...process.env, CI: 'true', npm_config_registry: REGISTRY },
      })
      child.once('error', (error) => {
        reject(new Error(`build-exe-for-desktop-shell: ${label} failed to spawn: ${error.message} (${printable})`))
      })
      child.once('exit', (code, signal) => {
        if (code === 0) {
          resolvePromise()
          return
        }
        const cause = code === null ? `signal ${signal ?? 'unknown'}` : `exit code ${code}`
        reject(new Error(`build-exe-for-desktop-shell: ${label} failed (${cause}): ${printable}`))
      })
    })
  }
}

async function main(): Promise<void> {
  const cli = BuildCli.parse(process.argv.slice(2))
  // The staging dir is shared by name across builds; two concurrent runs would
  // interleave deploy and patch steps. Fail fast instead.
  const lockDir = resolve(root, OUT_DIR, '.dsh-desktop-build-lock')
  if (!cli.dryRun) {
    try {
      await mkdir(lockDir)
    } catch {
      throw new Error(`build-exe-for-desktop-shell: another build holds ${lockDir}; remove it if no build is running.`)
    }
  }
  try {
    const pipeline = new SingleExeBuild(cli)
    console.log(`build-exe-for-desktop-shell: targets: ${cli.targets.map(target => target.spec).join(', ')}`)
    console.log(`build-exe-for-desktop-shell: staging: ${pipeline.staging}`)
    await pipeline.verifyClosure()
    await pipeline.build()
    await pipeline.deployStaging()
    await pipeline.injectPkgConfig()
    const products: string[] = []
    for (const target of cli.targets) products.push(...await pipeline.pack(target))
    pipeline.printProducts(products)
  } finally {
    if (!cli.dryRun) await rm(lockDir, { recursive: true, force: true })
  }
}

await main()
