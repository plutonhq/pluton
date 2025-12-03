/**
 * Build script for Windows Inno Setup Installer
 *
 * Usage:
 *   node build-installer.js                    # Build with defaults (Pluton)
 *   node build-installer.js --name pluton-pro  # Build PRO edition
 *
 * This script:
 *   1. Reads version from backend/package.json
 *   2. Updates the .iss file with correct version and name
 *   3. Runs Inno Setup compiler (iscc.exe)
 */

import { execSync } from "child_process";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, "..", "..");

// Parse command line arguments
const args = process.argv.slice(2);
const nameIndex = args.indexOf("--name");
const outputName =
  nameIndex !== -1 && args[nameIndex + 1] ? args[nameIndex + 1] : "pluton";

// Capitalize first letter and handle hyphenated names (pluton-pro -> Pluton Pro)
const displayName = outputName
  .split("-")
  .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
  .join(" ");

// Service name (no spaces, PascalCase: pluton-pro -> PlutonPro)
const serviceName = outputName
  .split("-")
  .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
  .join("");

// Get version from backend/package.json
const backendPackageJson = JSON.parse(
  readFileSync(join(rootDir, "backend", "package.json"), "utf-8")
);
const version = backendPackageJson.version || "0.0.0";

console.log("╔═══════════════════════════════════════════════════════════╗");
console.log("║   🪟 Windows Installer Build Script                       ║");
console.log("╚═══════════════════════════════════════════════════════════╝\n");
console.log(`  Name:         ${displayName}`);
console.log(`  Service:      ${serviceName}`);
console.log(`  Version:      ${version}`);
console.log(`  Output Name:  ${outputName}`);
console.log("");

// Path to the template and working .iss file
const templateIssPath = join(__dirname, "pluton-setup.iss");
const workingIssPath = join(__dirname, "pluton-setup.generated.iss");

// Check if template exists
if (!existsSync(templateIssPath)) {
  console.error(`❌ Template file not found: ${templateIssPath}`);
  process.exit(1);
}

// Read the template
let issContent = readFileSync(templateIssPath, "utf-8");

// Replace the #define values at the top of the file
issContent = issContent.replace(
  /#define MyAppName ".*"/,
  `#define MyAppName "${displayName}"`
);
issContent = issContent.replace(
  /#define MyAppVersion ".*"/,
  `#define MyAppVersion "${version}"`
);
issContent = issContent.replace(
  /#define MyAppServiceName ".*"/,
  `#define MyAppServiceName "${serviceName}"`
);

// Update file paths to use the correct distribution folder
// pluton-win-x64 or pluton-pro-win-x64
const distFolderName = `${outputName}-win-x64`;
issContent = issContent.replace(/pluton-win-x64/g, distFolderName);

// Update output filename
issContent = issContent.replace(
  /OutputBaseFilename=.*/,
  `OutputBaseFilename=${outputName}-setup`
);

// Write the generated .iss file
writeFileSync(workingIssPath, issContent, "utf-8");
console.log(`✅ Generated: ${workingIssPath}`);

// Find Inno Setup compiler
const possibleIsccPaths = [
  "C:\\Program Files (x86)\\Inno Setup 6\\ISCC.exe",
  "C:\\Program Files\\Inno Setup 6\\ISCC.exe",
  "C:\\Program Files (x86)\\Inno Setup 5\\ISCC.exe",
  "C:\\Program Files\\Inno Setup 5\\ISCC.exe",
];

let isccPath = null;
for (const path of possibleIsccPaths) {
  if (existsSync(path)) {
    isccPath = path;
    break;
  }
}

if (!isccPath) {
  console.error("❌ Inno Setup compiler (ISCC.exe) not found!");
  console.error(
    "   Please install Inno Setup from: https://jrsoftware.org/isdownload.php"
  );
  console.error("   Expected locations:");
  possibleIsccPaths.forEach((p) => console.error(`     - ${p}`));
  process.exit(1);
}

console.log(`\n📦 Using Inno Setup: ${isccPath}`);
console.log(`\n🔨 Building installer...\n`);

// Run Inno Setup compiler
try {
  execSync(`"${isccPath}" "${workingIssPath}"`, {
    stdio: "inherit",
    cwd: __dirname,
  });

  console.log(
    "\n╔═══════════════════════════════════════════════════════════╗"
  );
  console.log("║   ✅ Windows Installer Build Complete!                    ║");
  console.log("╚═══════════════════════════════════════════════════════════╝");
  console.log(`\n📁 Output: dist/installers/${outputName}-setup.exe\n`);
} catch (error) {
  console.error("\n❌ Failed to build installer");
  process.exit(1);
}
