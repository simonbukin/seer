const esbuild = require("esbuild");
const fs = require("fs");
const path = require("path");

// Build configuration
const buildConfig = {
  entryPoints: [
    "src/scripts/background.ts",
    "src/scripts/content.ts",
    "src/scripts/popup.ts",
    "src/scripts/options.ts",
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

    // Build CSS files
    await esbuild.build({
      entryPoints: ["src/styles/main.css"],
      bundle: true,
      outfile: "dist/styles/main.css",
      minify: false,
      sourcemap: false,
    });

    // Copy static files from src/
    const staticFiles = [
      { src: "src/manifest.json", dest: "dist/manifest.json" },
      { src: "src/pages/popup.html", dest: "dist/popup.html" },
      { src: "src/pages/options.html", dest: "dist/options.html" },
    ];

    // Copy icon files
    const iconFiles = [
      {
        src: "src/assets/icons/icon-16.png",
        dest: "dist/assets/icons/icon-16.png",
      },
      {
        src: "src/assets/icons/icon-32.png",
        dest: "dist/assets/icons/icon-32.png",
      },
      {
        src: "src/assets/icons/icon-48.png",
        dest: "dist/assets/icons/icon-48.png",
      },
      {
        src: "src/assets/icons/icon-128.png",
        dest: "dist/assets/icons/icon-128.png",
      },
    ];

    for (const file of staticFiles) {
      if (fs.existsSync(file.src)) {
        fs.copyFileSync(file.src, file.dest);
        console.log(`Copied ${file.src} -> ${file.dest}`);
      } else {
        console.warn(`Warning: ${file.src} not found, skipping...`);
      }
    }

    // Ensure directories exist in dist
    if (!fs.existsSync("dist/assets")) {
      fs.mkdirSync("dist/assets");
    }
    if (!fs.existsSync("dist/assets/icons")) {
      fs.mkdirSync("dist/assets/icons");
    }
    if (!fs.existsSync("dist/styles")) {
      fs.mkdirSync("dist/styles");
    }

    // Copy icon files
    for (const file of iconFiles) {
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
