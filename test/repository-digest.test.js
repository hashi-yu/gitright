import assert from "node:assert/strict";
import { chmod, lstat, mkdtemp, symlink, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { directoryDigest } from "../docs/proofs/fixtures/repository-digest.mjs";

test("repository digest covers modes, raw path bytes, symlink targets, and contents", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "gitright-repository-digest-"));
  const file = path.join(root, "file");
  const rawPath = Buffer.from(`${root}/raw-\nname`);
  const link = path.join(root, "link");
  await writeFile(file, "one\n");
  await writeFile(rawPath, "raw\n");
  await symlink("file", link);
  const initial = await directoryDigest(root);

  await chmod(file, 0o755);
  assert.notEqual(await directoryDigest(root), initial);
  await chmod(file, 0o644);
  assert.equal(await directoryDigest(root), initial);

  const rootMode = (await lstat(root)).mode & 0o777;
  await chmod(root, rootMode === 0o700 ? 0o755 : 0o700);
  assert.notEqual(await directoryDigest(root), initial);
  await chmod(root, rootMode);
  assert.equal(await directoryDigest(root), initial);

  await unlink(link);
  await symlink("raw-target", link);
  assert.notEqual(await directoryDigest(root), initial);
  await unlink(link);
  await symlink("file", link);
  assert.equal(await directoryDigest(root), initial);

  await writeFile(rawPath, "changed raw\n");
  assert.notEqual(await directoryDigest(root), initial);
  await writeFile(rawPath, "raw\n");
  assert.equal(await directoryDigest(root), initial);

  await writeFile(file, "two\n");
  assert.notEqual(await directoryDigest(root), initial);
});
