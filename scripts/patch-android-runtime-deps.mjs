import fs from "node:fs";
import path from "node:path";

const runtimeRoot = path.resolve(process.argv[2] || "android-manager/runtime");
const fastUriRoot = path.join(runtimeRoot, "node_modules", "fast-uri");
const packageFile = path.join(fastUriRoot, "package.json");
const sourceFile = path.join(fastUriRoot, "index.js");

if (!fs.existsSync(packageFile) || !fs.existsSync(sourceFile)) {
  throw new Error(`fast-uri is missing from Android runtime dependencies: ${fastUriRoot}`);
}

const manifest = JSON.parse(fs.readFileSync(packageFile, "utf8"));
if (manifest.version !== "3.1.8") {
  throw new Error(`Android runtime expected fast-uri 3.1.8 but installed ${manifest.version || "unknown"}`);
}

const unsupported = String.raw`!/\P{ASCII}/u.test(resolvedHost)`;
const compatible = "!/[^\\x00-\\x7F]/.test(resolvedHost)";
let source = fs.readFileSync(sourceFile, "utf8");
if (source.includes(unsupported)) {
  source = source.replace(unsupported, compatible);
  fs.writeFileSync(sourceFile, source, "utf8");
} else if (!source.includes(compatible)) {
  throw new Error("fast-uri 3.1.8 compatibility patch target was not found");
}

console.log(`Patched fast-uri ${manifest.version} for the embedded Node 18 mobile runtime.`);
