const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { DEFAULT_SCRIPTS } = require("../src/shared/game-data.js");

test("default script roles have dedicated AI player prompts", () => {
  const promptsRoot = path.resolve(__dirname, "../prompts/roles");
  const missing = DEFAULT_SCRIPTS[0].roles
    .map((role) => role.id)
    .filter((roleId) => !fs.existsSync(path.join(promptsRoot, `${roleId}.md`)));

  assert.deepEqual(missing, []);
});

test("role prompts include actionable role-specific guidance", () => {
  const promptsRoot = path.resolve(__dirname, "../prompts/roles");
  for (const role of DEFAULT_SCRIPTS[0].roles) {
    const content = fs.readFileSync(path.join(promptsRoot, `${role.id}.md`), "utf8").trim();
    assert.match(content, new RegExp(role.name), `${role.id} prompt should name the visible role`);
    assert.ok(content.length >= 80, `${role.id} prompt is too thin to guide behavior`);
  }
});
