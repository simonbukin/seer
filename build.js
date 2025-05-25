const esbuild = require("esbuild");
const fs = require("fs");
const path = require("path");

async function build() {
  const out = "dist";

  // Create dist directory if it doesn't exist
  if (!fs.existsSync(out)) {
    fs.mkdirSync(out, { recursive: true });
  }

  // Build TypeScript files
  await esbuild.build({
    entryPoints: ["src/background.ts", "src/content.ts", "src/popup.ts"],
    bundle: true,
    outdir: out,
    format: "iife",
    target: ["chrome115"],
    minify: true,
    platform: "browser",
  });

  // Copy static files
  fs.copyFileSync("manifest.json", path.join(out, "manifest.json"));
  fs.copyFileSync("src/popup.html", path.join(out, "popup.html"));
  fs.copyFileSync("public/icon.png", path.join(out, "icon.png"));

  console.log("Build completed successfully!");
}

build().catch(console.error);
