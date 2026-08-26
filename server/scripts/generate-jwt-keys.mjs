import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { generateKeyPairSync } from "node:crypto";

const RSA_MODULUS_LENGTH = 3072;

function parseArgs(argv) {
  const options = { outputDir: null, overwrite: false };
  for (let index = 2; index < argv.length; index += 1) {
    const current = argv[index];
    if (current === "--output-dir") {
      options.outputDir = argv[index + 1];
      index += 1;
      continue;
    }
    if (current === "--overwrite") {
      options.overwrite = true;
    }
  }
  return options;
}

function writeKeyPair({ outputDir, prefix, overwrite }) {
  const privatePath = resolve(outputDir, `${prefix}-current-private.pem`);
  const publicPath = resolve(outputDir, `${prefix}-current-public.pem`);
  if (!overwrite && (existsSync(privatePath) || existsSync(publicPath))) {
    throw new Error(`Refusing to overwrite existing ${prefix} key files. Use --overwrite to replace them.`);
  }
  const { privateKey, publicKey } = generateKeyPairSync("rsa", {
    modulusLength: RSA_MODULUS_LENGTH,
    publicKeyEncoding: { format: "pem", type: "spki" },
    privateKeyEncoding: { format: "pem", type: "pkcs8" },
  });
  writeFileSync(privatePath, privateKey, { mode: 0o600 });
  writeFileSync(publicPath, publicKey, { mode: 0o644 });
  return { privatePath, publicPath };
}

function main() {
  const { outputDir, overwrite } = parseArgs(process.argv);
  const resolvedOutputDir = resolve(outputDir || process.cwd());
  mkdirSync(resolvedOutputDir, { recursive: true });
  const access = writeKeyPair({ outputDir: resolvedOutputDir, prefix: "access", overwrite });
  const refresh = writeKeyPair({ outputDir: resolvedOutputDir, prefix: "refresh", overwrite });
  console.log(`Generated access keys: ${access.privatePath} / ${access.publicPath}`);
  console.log(`Generated refresh keys: ${refresh.privatePath} / ${refresh.publicPath}`);
  console.log("Previous-key env vars may be left blank for first deployment.");
}

main();
