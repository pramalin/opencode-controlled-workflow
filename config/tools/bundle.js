import { tool } from "@opencode-ai/plugin"
import {
  mkdir,
  readFile,
  writeFile,
  readdir,
  chmod
} from "node:fs/promises"
import path from "node:path"

const ROOT = "/bundle"
const META = "metadata.json"
const DIR_MODE = 0o2775
const FILE_MODE = 0o664

function slugify(value) {
  const slug = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64)

  if (!slug || !/^[a-z0-9]/.test(slug)) {
    throw new Error("Work label must contain at least one letter or digit.")
  }
  return slug
}

function validatePhase(value) {
  if (value !== "implementation" && value !== "finalize") {
    throw new Error("phase must be 'implementation' or 'finalize'")
  }
  return value
}

function validateStatus(value) {
  if (value !== "modified" && value !== "new") {
    throw new Error("status must be 'modified' or 'new'")
  }
  return value
}

function validateBundleId(bundleId) {
  const id = String(bundleId || "").trim()
  if (!/^[a-z0-9][a-z0-9._-]{0,63}\/\d{3}(?:-final)?$/.test(id)) {
    throw new Error(`Invalid bundle ID '${bundleId}'`)
  }
  return id
}

function safeRelative(relativePath) {
  const input = String(relativePath || "").replaceAll("\\", "/").trim()
  if (!input || input.startsWith("/") || input.includes("\0")) {
    throw new Error("Path must be a non-empty repository-relative path.")
  }

  const normalized = path.posix.normalize(input)
  if (
    normalized === "." ||
    normalized === ".." ||
    normalized.startsWith("../") ||
    normalized.includes("/../") ||
    normalized === ".git" ||
    normalized.startsWith(".git/")
  ) {
    throw new Error(`Unsafe repository-relative path '${relativePath}'`)
  }

  return normalized
}

function inside(base, candidate) {
  const b = path.resolve(base)
  const c = path.resolve(candidate)
  return c === b || c.startsWith(b + path.sep)
}


async function ensureDirectoryTree(base, target) {
  const root = path.resolve(base)
  const destination = path.resolve(target)

  if (!inside(root, destination)) {
    throw new Error("Directory path escaped its allowed root.")
  }

  // ROOT itself is prepared once on the host with the intended shared group.
  // Preserve that group and make every created directory group-writable + setgid
  // so nested bundle content keeps inheriting the same group.
  if (destination === root) return

  const relative = path.relative(root, destination)
  let current = root
  for (const part of relative.split(path.sep)) {
    current = path.join(current, part)
    try {
      await mkdir(current, { mode: DIR_MODE })
    } catch (error) {
      if (error?.code !== "EEXIST") throw error
    }
    await chmod(current, DIR_MODE)
  }
}

async function writeManagedFile(target, content) {
  await writeFile(target, content, { encoding: "utf8", mode: FILE_MODE })
  await chmod(target, FILE_MODE)
}

function bundleDir(bundleId) {
  const id = validateBundleId(bundleId)
  const dir = path.resolve(ROOT, id)
  if (!inside(ROOT, dir)) throw new Error("Bundle path escaped bundle root.")
  return dir
}

async function loadMeta(bundleId) {
  const dir = bundleDir(bundleId)
  const raw = await readFile(path.join(dir, META), "utf8")
  return JSON.parse(raw)
}

async function saveMeta(bundleId, meta) {
  const dir = bundleDir(bundleId)
  await writeManagedFile(path.join(dir, META), JSON.stringify(meta, null, 2) + "\n")
}

function assertOpen(meta) {
  if (meta.completedAt) {
    throw new Error(
      `Bundle '${meta.bundleId}' is already complete and immutable. ` +
      "Create a new numbered bundle for corrections."
    )
  }
}

function upsertEntry(meta, entry) {
  const key = entry.type === "rename"
    ? `${entry.type}:${entry.from}->${entry.to}`
    : `${entry.type}:${entry.path}`

  meta.entries = (meta.entries || []).filter((item) => {
    const itemKey = item.type === "rename"
      ? `${item.type}:${item.from}->${item.to}`
      : `${item.type}:${item.path}`
    return itemKey !== key
  })
  meta.entries.push(entry)
}

function hostPaths() {
  const repo = process.env.HOST_REPO_PATH
  const bundles = process.env.HOST_BUNDLE_ROOT

  if (!repo || !path.isAbsolute(repo)) {
    throw new Error("HOST_REPO_PATH must be an absolute host path.")
  }
  if (!bundles || !path.isAbsolute(bundles) || bundles === "/") {
    throw new Error("HOST_BUNDLE_ROOT must be a safe absolute host path.")
  }
  return { repo: path.resolve(repo), bundles: path.resolve(bundles) }
}

function shellQuote(value) {
  return "'" + String(value).replaceAll("'", "'\"'\"'") + "'"
}

function group(meta, type) {
  return (meta.entries || []).filter((e) => e.type === type)
}

function manifestText(meta, summary) {
  const { repo, bundles } = hostPaths()
  const filesHostDir = path.join(bundles, meta.bundleId, "files")

  const modified = group(meta, "modified")
  const added = group(meta, "new")
  const removed = group(meta, "delete")
  const renamed = group(meta, "rename")

  const out = []
  out.push(`# Bundle ${meta.bundleId}`)
  out.push("")
  out.push(`Phase: ${meta.phase}`)
  out.push(`Created: ${meta.createdAt}`)
  out.push("")
  out.push("## Summary")
  out.push("")
  out.push(summary || "(none)")
  out.push("")

  const section = (title, lines) => {
    out.push(`## ${title}`)
    out.push("")
    if (lines.length === 0) out.push("(none)")
    else out.push(...lines.map((x) => `- ${x}`))
    out.push("")
  }

  section("Modified", modified.map((e) => e.path))
  section("New", added.map((e) => e.path))
  section("Deleted manually", removed.map((e) =>
    e.reason ? `${e.path} — ${e.reason}` : e.path
  ))
  section("Renamed", renamed.map((e) =>
    `${e.from} -> ${e.to}${e.reason ? ` — ${e.reason}` : ""}`
  ))

  out.push("## Apply complete files")
  out.push("")
  out.push("```bash")
  out.push(
    `rsync -av -- ${shellQuote(filesHostDir + path.sep)} ${shellQuote(repo + path.sep)}`
  )
  out.push("```")
  out.push("")
  out.push("Do NOT add `--delete`. The bundle intentionally contains only changed/new destination files.")
  out.push("")

  if (removed.length || renamed.length) {
    out.push("## Manual removals after applying files")
    out.push("")
    out.push("Review these before executing them:")
    out.push("")
    out.push("```bash")
    for (const e of removed) {
      out.push(`rm -- ${shellQuote(path.join(repo, e.path))}`)
    }
    for (const e of renamed) {
      out.push(`rm -- ${shellQuote(path.join(repo, e.from))}`)
    }
    out.push("```")
    out.push("")
  }

  return out.join("\n")
}

export const begin = tool({
  description:
    "Create the next immutable numbered bundle for a logical work item.",

  args: {
    work: tool.schema.string().describe(
      "Stable work label reused across all iterations, e.g. mapping-memory"
    ),
    phase: tool.schema.string().describe(
      "Exactly 'implementation' or 'finalize'"
    )
  },

  async execute(args) {
    const work = slugify(args.work)
    const phase = validatePhase(args.phase)
    const workDir = path.resolve(ROOT, work)
    if (!inside(ROOT, workDir)) throw new Error("Work path escaped bundle root.")

    await ensureDirectoryTree(ROOT, workDir)

    const names = await readdir(workDir).catch(() => [])
    let max = 0
    for (const name of names) {
      const m = /^(\d{3})(?:-final)?$/.exec(name)
      if (m) max = Math.max(max, Number(m[1]))
    }

    const number = String(max + 1).padStart(3, "0")
    const leaf = phase === "finalize" ? `${number}-final` : number
    const bundleId = `${work}/${leaf}`
    const dir = bundleDir(bundleId)

    await ensureDirectoryTree(workDir, dir)
    await ensureDirectoryTree(dir, path.join(dir, "files"))

    const meta = {
      version: 1,
      work,
      phase,
      bundleId,
      createdAt: new Date().toISOString(),
      entries: []
    }
    await saveMeta(bundleId, meta)

    return JSON.stringify({
      bundleId,
      filesRoot: `/bundle/${bundleId}/files`,
      manifest: `/bundle/${bundleId}/manifest.md`
    }, null, 2)
  }
})

export const write = tool({
  description:
    "Write one COMPLETE modified or new repository file into an existing bundle.",

  args: {
    bundleId: tool.schema.string().describe("Bundle ID returned by bundle_begin"),
    relativePath: tool.schema.string().describe("Repository-relative destination path"),
    status: tool.schema.string().describe("Exactly 'modified' or 'new'"),
    content: tool.schema.string().describe("Complete resulting file content")
  },

  async execute(args) {
    const id = validateBundleId(args.bundleId)
    const rel = safeRelative(args.relativePath)
    const status = validateStatus(args.status)
    const dir = bundleDir(id)
    const target = path.resolve(dir, "files", rel)

    if (!inside(path.join(dir, "files"), target)) {
      throw new Error("File path escaped bundle files directory.")
    }

    const meta = await loadMeta(id)
    assertOpen(meta)

    await ensureDirectoryTree(path.join(dir, "files"), path.dirname(target))
    await writeManagedFile(target, args.content)
    upsertEntry(meta, { type: status, path: rel })
    await saveMeta(id, meta)

    return `Wrote complete ${status} file: ${rel}`
  }
})

export const remove = tool({
  description:
    "Record a repository file that the user should delete manually. Does not delete anything.",

  args: {
    bundleId: tool.schema.string(),
    relativePath: tool.schema.string(),
    reason: tool.schema.string().describe("Short reason for deletion")
  },

  async execute(args) {
    const id = validateBundleId(args.bundleId)
    const rel = safeRelative(args.relativePath)
    const meta = await loadMeta(id)
    assertOpen(meta)

    upsertEntry(meta, {
      type: "delete",
      path: rel,
      reason: String(args.reason || "").trim()
    })
    await saveMeta(id, meta)

    return `Recorded manual deletion: ${rel}`
  }
})

export const rename = tool({
  description:
    "Record a rename and write the COMPLETE destination file. The user removes the old path manually.",

  args: {
    bundleId: tool.schema.string(),
    fromPath: tool.schema.string(),
    toPath: tool.schema.string(),
    content: tool.schema.string().describe("Complete resulting destination file"),
    reason: tool.schema.string().describe("Short reason for rename")
  },

  async execute(args) {
    const id = validateBundleId(args.bundleId)
    const from = safeRelative(args.fromPath)
    const to = safeRelative(args.toPath)

    if (from === to) throw new Error("Rename source and destination are identical.")

    const dir = bundleDir(id)
    const target = path.resolve(dir, "files", to)
    if (!inside(path.join(dir, "files"), target)) {
      throw new Error("Rename destination escaped bundle files directory.")
    }

    const meta = await loadMeta(id)
    assertOpen(meta)

    await ensureDirectoryTree(path.join(dir, "files"), path.dirname(target))
    await writeManagedFile(target, args.content)
    upsertEntry(meta, {
      type: "rename",
      from,
      to,
      reason: String(args.reason || "").trim()
    })
    await saveMeta(id, meta)

    return `Recorded rename ${from} -> ${to} and wrote complete destination file.`
  }
})

export const complete = tool({
  description:
    "Finalize an immutable bundle by writing a human-readable manifest and returning host apply instructions.",

  args: {
    bundleId: tool.schema.string(),
    summary: tool.schema.string().describe("Concise summary of this bundle")
  },

  async execute(args) {
    const id = validateBundleId(args.bundleId)
    const meta = await loadMeta(id)
    assertOpen(meta)

    if (!meta.entries || meta.entries.length === 0) {
      throw new Error("Refusing to complete an empty bundle.")
    }

    meta.completedAt = new Date().toISOString()
    const text = manifestText(meta, String(args.summary || "").trim())
    const manifest = path.join(bundleDir(id), "manifest.md")
    await writeManagedFile(manifest, text + "\n")
    await saveMeta(id, meta)

    return text
  }
})

export const cleanup_info = tool({
  description:
    "Return the host-side cleanup command for one completed work label. Never deletes anything.",

  args: {
    work: tool.schema.string().describe("Stable work label used by the bundles")
  },

  async execute(args) {
    const work = slugify(args.work)
    const { bundles } = hostPaths()
    const target = path.resolve(bundles, work)

    if (!inside(bundles, target) || target === path.resolve(bundles)) {
      throw new Error("Unsafe cleanup target.")
    }

    // Make cleanup advice more informative without mutating anything.
    const containerTarget = path.resolve(ROOT, work)
    let bundleNames = []
    try {
      const entries = await readdir(containerTarget)
      bundleNames = entries
        .filter((x) => /^\d{3}(?:-final)?$/.test(x))
        .sort()
    } catch {
      bundleNames = []
    }

    return [
      `Completed-work bundle directory: ${target}`,
      `Known bundles: ${bundleNames.length ? bundleNames.join(", ") : "(none found)"}`,
      "After verifying the commit and that these bundles are no longer needed:",
      `rm -rf -- ${shellQuote(target)}`
    ].join("\n")
  }
})
