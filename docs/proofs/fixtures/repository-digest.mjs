#!/usr/bin/env node

import { createHash } from "node:crypto";
import { lstat, readFile, readdir, readlink } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export async function directoryDigest(root) {
  const hash = createHash("sha256");

  async function visit(path, relative) {
    const stat = await lstat(path);
    hash.update(relative);
    hash.update(`\0${stat.mode}\0`);
    if (stat.isSymbolicLink()) {
      hash.update("link\0");
      hash.update(await readlink(path, { encoding: "buffer" }));
      hash.update("\0");
      return;
    }
    if (stat.isDirectory()) {
      hash.update("directory\0");
      const entries = await readdir(path, { encoding: "buffer" });
      entries.sort(Buffer.compare);
      for (const entry of entries) {
        await visit(
          Buffer.concat([path, Buffer.from("/"), entry]),
          Buffer.concat([relative, Buffer.from("/"), entry]),
        );
      }
      return;
    }
    hash.update("file\0");
    hash.update(await readFile(path));
    hash.update("\0");
  }

  await visit(Buffer.from(root), Buffer.from("."));
  return hash.digest("hex");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!process.argv[2]) {
    process.stderr.write("usage: repository-digest.mjs <directory>\n");
    process.exitCode = 64;
  } else {
    process.stdout.write(`${await directoryDigest(process.argv[2])}\n`);
  }
}
