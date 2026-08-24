import { expect, test } from "bun:test"
import path from "node:path"

test.each([
  { channel: "casual", attempt: "1", version: "", expected: "0.0.0-casual-abcdef0123-42" },
  { channel: "casual", attempt: "2", version: "", expected: "0.0.0-casual-abcdef0123-42.2" },
  { channel: "casual", attempt: "1", version: "1.2.3", expected: "1.2.3" },
  { channel: "preview", attempt: "1", version: "", expected: "0.0.0-preview-42" },
])("build version $expected", (input) => {
  const result = Bun.spawnSync(
    [process.execPath, "--eval", 'import { Script } from "./src/index.ts"; console.log(Script.version)'],
    {
      cwd: path.resolve(import.meta.dirname, ".."),
      env: {
        ...process.env,
        OPENCODE_CHANNEL: input.channel,
        OPENCODE_BASE_SHA: "abcdef0123456789abcdef0123456789abcdef0123",
        OPENCODE_VERSION: input.version,
        OPENCODE_BUMP: "",
        OPENCODE_RELEASE: "",
        GITHUB_RUN_NUMBER: "42",
        GITHUB_RUN_ATTEMPT: input.attempt,
      },
    },
  )
  expect(result.exitCode).toBe(0)
  expect(result.stdout.toString().trim().split("\n").at(-1)).toBe(input.expected)
})
