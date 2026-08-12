import { tool } from "@opencode-ai/plugin"
import { Buffer } from "node:buffer"

const REPO = "/root/repo"
const MAX_OUTPUT_BYTES = 2 * 1024 * 1024

const COMMANDS = {
  status: [
    "git", "-c", "safe.directory=/root/repo", "--no-optional-locks",
    "status", "--short", "--untracked-files=all"
  ],
  name_status: [
    "git", "-c", "safe.directory=/root/repo", "--no-optional-locks",
    "diff", "--no-ext-diff", "--name-status", "HEAD", "--"
  ],
  diff: [
    "git", "-c", "safe.directory=/root/repo", "--no-optional-locks",
    "diff", "--no-ext-diff", "HEAD", "--"
  ],
  recent_log: [
    "git", "-c", "safe.directory=/root/repo", "--no-optional-locks",
    "log", "-10", "--pretty=format:%h%x09%s"
  ]
}

async function collect(stream) {
  const reader = stream.getReader()
  const chunks = []
  let total = 0
  let truncated = false

  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    if (!value) continue

    const remaining = MAX_OUTPUT_BYTES - total
    if (remaining <= 0) {
      truncated = true
      break
    }

    if (value.byteLength <= remaining) {
      chunks.push(value)
      total += value.byteLength
    } else {
      chunks.push(value.slice(0, remaining))
      total += remaining
      truncated = true
      break
    }
  }

  const data = Buffer.concat(chunks.map((c) => Buffer.from(c))).toString("utf8")
  return { data, truncated }
}

export default tool({
  description:
    "Inspect Git state using one of four fixed read-only operations. " +
    "No arbitrary command or arguments are accepted.",

  args: {
    operation: tool.schema.string().describe(
      "Exactly one of: status, name_status, diff, recent_log"
    )
  },

  async execute(args) {
    const command = COMMANDS[args.operation]
    if (!command) {
      throw new Error(
        `Unsupported operation '${args.operation}'. ` +
        "Allowed: status, name_status, diff, recent_log"
      )
    }

    const proc = Bun.spawn(command, {
      cwd: REPO,
      stdout: "pipe",
      stderr: "pipe",
      env: {
        ...process.env,
        GIT_OPTIONAL_LOCKS: "0",
        GIT_CONFIG_NOSYSTEM: "1"
      }
    })

    const [stdout, stderr, exitCode] = await Promise.all([
      collect(proc.stdout),
      collect(proc.stderr),
      proc.exited
    ])

    if (exitCode !== 0) {
      throw new Error(
        `git_inspect ${args.operation} failed with exit code ${exitCode}\n` +
        stderr.data
      )
    }

    const suffix = stdout.truncated
      ? "\n\n[output truncated at 2 MiB]"
      : ""

    return stdout.data + suffix
  }
})
