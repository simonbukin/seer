const esbuild = require("esbuild");
const fs = require("fs");
const path = require("path");

// Build configuration
const buildConfig = {
  entryPoints: [
    "src/background.ts",
    "src/content.ts",
    "src/popup.ts",
    "src/options.ts",
  ],
  bundle: true,
  outdir: "dist",
  format: "iife",
  target: "chrome88",
  minify: false,
  sourcemap: false,
  define: {
    "process.env.NODE_ENV": '"production"',
  },
};

async function build() {
  try {
    // Ensure dist directory exists
    if (!fs.existsSync("dist")) {
      fs.mkdirSync("dist");
    }

    // Build TypeScript files
    await esbuild.build(buildConfig);

    // Copy static files
    const staticFiles = [
      { src: "manifest.json", dest: "dist/manifest.json" },
      { src: "src/popup.html", dest: "dist/popup.html" },
      { src: "src/options.html", dest: "dist/options.html" },
      { src: "test-unified.html", dest: "dist/test-unified.html" },
      { src: "public/icon.png", dest: "dist/icon.png" },
    ];

    for (const file of staticFiles) {
      if (fs.existsSync(file.src)) {
        fs.copyFileSync(file.src, file.dest);
        console.log(`Copied ${file.src} -> ${file.dest}`);
      } else {
        console.warn(`Warning: ${file.src} not found, skipping...`);
      }
    }

    console.log("Build completed successfully!");
  } catch (error) {
    console.error("Build failed:", error);
    process.exit(1);
  }
}

build();
