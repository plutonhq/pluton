import { execSync } from "child_process";
import {
  readdir,
  readFile,
  writeFile,
  mkdir,
  copyFile,
  rm,
  access,
  chmod,
} from "fs/promises";
import { join, dirname, extname, resolve } from "path";
import { fileURLToPath } from "url";
import { constants } from "fs";
import https from "https";
import fs from "fs";
import { createWriteStream } from "fs";
import os from "os";
import AdmZip from "adm-zip";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = resolve(__dirname, "..");
const backendDir = resolve(rootDir, "backend");
const frontendDir = resolve(rootDir, "frontend");

console.log("╔═══════════════════════════════════════════════════════════╗");
console.log("║   🚀 Pluton Multi-Platform Executable Build Script       ║");
console.log("╚═══════════════════════════════════════════════════════════╝\n");

// Version configuration - Update these to use latest versions
const BETTER_SQLITE3_VERSION = "12.4.4"; // Latest: Check https://github.com/WiseLibs/better-sqlite3/releases
const RESTIC_VERSION = "0.18.1"; // Latest: Check https://github.com/restic/restic/releases
const RCLONE_VERSION = "1.71.2"; // Latest: Check https://rclone.org/downloads/

// Target configurations
const targets = {
  "win-x64": {
    pkgTarget: "node24-win-x64",
    executableName: "pluton.exe",
    binaryPlatform: "win32-x64",
    nodeVersion: "24",
    betterSqlite3Url: `https://github.com/WiseLibs/better-sqlite3/releases/download/v${BETTER_SQLITE3_VERSION}/better-sqlite3-v${BETTER_SQLITE3_VERSION}-node-v137-win32-x64.tar.gz`,
    resticUrl: `https://github.com/restic/restic/releases/download/v${RESTIC_VERSION}/restic_${RESTIC_VERSION}_windows_amd64.zip`,
    rcloneUrl: `https://downloads.rclone.org/v${RCLONE_VERSION}/rclone-v${RCLONE_VERSION}-windows-amd64.zip`,
  },
  "linux-x64": {
    pkgTarget: "node24-linux-x64",
    executableName: "pluton",
    binaryPlatform: "linux-x64",
    nodeVersion: "24",
    betterSqlite3Url: `https://github.com/WiseLibs/better-sqlite3/releases/download/v${BETTER_SQLITE3_VERSION}/better-sqlite3-v${BETTER_SQLITE3_VERSION}-node-v137-linux-x64.tar.gz`,
    resticUrl: `https://github.com/restic/restic/releases/download/v${RESTIC_VERSION}/restic_${RESTIC_VERSION}_linux_amd64.bz2`,
    rcloneUrl: `https://downloads.rclone.org/v${RCLONE_VERSION}/rclone-v${RCLONE_VERSION}-linux-amd64.zip`,
  },
  "linux-arm64": {
    pkgTarget: "node24-linux-arm64",
    executableName: "pluton",
    binaryPlatform: "linux-arm64",
    nodeVersion: "24",
    betterSqlite3Url: `https://github.com/WiseLibs/better-sqlite3/releases/download/v${BETTER_SQLITE3_VERSION}/better-sqlite3-v${BETTER_SQLITE3_VERSION}-node-v137-linux-arm64.tar.gz`,
    resticUrl: `https://github.com/restic/restic/releases/download/v${RESTIC_VERSION}/restic_${RESTIC_VERSION}_linux_arm64.bz2`,
    rcloneUrl: `https://downloads.rclone.org/v${RCLONE_VERSION}/rclone-v${RCLONE_VERSION}-linux-arm64.zip`,
  },
  "macos-x64": {
    pkgTarget: "node24-macos-x64",
    executableName: "pluton",
    binaryPlatform: "darwin-x64",
    nodeVersion: "24",
    betterSqlite3Url: `https://github.com/WiseLibs/better-sqlite3/releases/download/v${BETTER_SQLITE3_VERSION}/better-sqlite3-v${BETTER_SQLITE3_VERSION}-node-v137-darwin-x64.tar.gz`,
    resticUrl: `https://github.com/restic/restic/releases/download/v${RESTIC_VERSION}/restic_${RESTIC_VERSION}_darwin_amd64.bz2`,
    rcloneUrl: `https://downloads.rclone.org/v${RCLONE_VERSION}/rclone-v${RCLONE_VERSION}-osx-amd64.zip`,
  },
  "macos-arm64": {
    pkgTarget: "node24-macos-arm64",
    executableName: "pluton",
    binaryPlatform: "darwin-arm64",
    nodeVersion: "24",
    betterSqlite3Url: `https://github.com/WiseLibs/better-sqlite3/releases/download/v${BETTER_SQLITE3_VERSION}/better-sqlite3-v${BETTER_SQLITE3_VERSION}-node-v137-darwin-arm64.tar.gz`,
    resticUrl: `https://github.com/restic/restic/releases/download/v${RESTIC_VERSION}/restic_${RESTIC_VERSION}_darwin_arm64.bz2`,
    rcloneUrl: `https://downloads.rclone.org/v${RCLONE_VERSION}/rclone-v${RCLONE_VERSION}-osx-arm64.zip`,
  },
};

/**
 * Execute a command and log the output
 */
function exec(command, options = {}) {
  console.log(`\n📦 Executing: ${command}`);
  try {
    execSync(command, { stdio: "inherit", ...options });
  } catch (error) {
    console.error(`❌ Command failed: ${command}`);
    throw error;
  }
}

/**
 * Download a file from a URL
 */
async function downloadFile(url, destPath) {
  console.log(`⬇️  Downloading: ${url}`);
  return new Promise((resolve, reject) => {
    const file = createWriteStream(destPath);
    https
      .get(url, (response) => {
        if (response.statusCode === 302 || response.statusCode === 301) {
          // Follow redirect
          https
            .get(response.headers.location, (redirectResponse) => {
              redirectResponse.pipe(file);
              file.on("finish", () => {
                file.close();
                resolve();
              });
            })
            .on("error", reject);
        } else {
          response.pipe(file);
          file.on("finish", () => {
            file.close();
            resolve();
          });
        }
      })
      .on("error", (err) => {
        try {
          fs.unlinkSync(destPath);
        } catch {}
        reject(err);
      });
  });
}

/**
 * Check if a file exists
 */
async function fileExists(path) {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Step 1: Build Frontend
 */
async function buildFrontend() {
  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("📦 Step 1: Building Frontend");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  exec("pnpm install", { cwd: frontendDir });
  exec("pnpm run build", { cwd: frontendDir });

  console.log("✅ Frontend build completed");
}

/**
 * Step 2: Copy Frontend Build to Backend
 */
async function copyFrontendToBackend() {
  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("📦 Step 2: Copying Frontend Build to Backend");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  const frontendDistDir = join(frontendDir, "dist");
  const backendPublicDir = join(backendDir, "public");

  // Remove existing public directory
  try {
    await rm(backendPublicDir, { recursive: true, force: true });
  } catch (error) {
    // Ignore if doesn't exist
  }

  // Copy frontend dist to backend public
  await mkdir(backendPublicDir, { recursive: true });
  await copyDirectory(frontendDistDir, backendPublicDir);

  console.log("✅ Frontend copied to backend/public");
}

/**
 * Copy directory recursively
 */
async function copyDirectory(src, dest) {
  await mkdir(dest, { recursive: true });
  const entries = await readdir(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = join(src, entry.name);
    const destPath = join(dest, entry.name);

    if (entry.isDirectory()) {
      await copyDirectory(srcPath, destPath);
    } else {
      await copyFile(srcPath, destPath);
    }
  }
}

/**
 * Step 3: Install Backend Dependencies
 */
async function installBackendDeps() {
  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("📦 Step 3: Installing Backend Dependencies");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  exec("pnpm install", { cwd: backendDir });

  console.log("✅ Backend dependencies installed");
}

/**
 * Step 4: Compile TypeScript Backend
 */
async function compileBackend() {
  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("📦 Step 4: Compiling TypeScript Backend");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  exec("pnpm run build:pkg", { cwd: backendDir });

  console.log("✅ Backend compiled successfully");
}

/**
 * Step 5: Download and Setup better-sqlite3 Native Binaries
 */
async function setupBetterSqlite3() {
  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("📦 Step 5: Setting up better-sqlite3 Native Binaries");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  const pkgAssetsDir = join(rootDir, "dist", "pkg-assets");

  await mkdir(pkgAssetsDir, { recursive: true });

  // Check if all better-sqlite3 binaries already exist (caching)
  let allSqliteBinariesExist = true;
  for (const [platform, config] of Object.entries(targets)) {
    const platformAssetsDir = join(pkgAssetsDir, platform, "better-sqlite3");
    const nodeFilePath = join(
      platformAssetsDir,
      "build",
      "Release",
      "better_sqlite3.node"
    );

    if (!(await fileExists(nodeFilePath))) {
      allSqliteBinariesExist = false;
      break;
    }
  }

  if (allSqliteBinariesExist) {
    console.log(
      "✅ All better-sqlite3 binaries already exist, skipping download\n"
    );
    console.log("💡 To force re-download, delete the dist/pkg-assets folder");
    return;
  }

  for (const [platform, config] of Object.entries(targets)) {
    console.log(`\n🔧 Setting up better-sqlite3 for ${platform}...`);

    const platformAssetsDir = join(pkgAssetsDir, platform, "better-sqlite3");
    const nodeFilePath = join(
      platformAssetsDir,
      "build",
      "Release",
      "better_sqlite3.node"
    );

    // Skip if already exists (individual platform caching)
    if (await fileExists(nodeFilePath)) {
      console.log(
        `  ✓ better-sqlite3 already exists for ${platform}, skipping download`
      );
      continue;
    }

    await mkdir(platformAssetsDir, { recursive: true });

    try {
      // Download the pre-built binary
      const tempFile = join(pkgAssetsDir, `better-sqlite3-${platform}.tar.gz`);
      await downloadFile(config.betterSqlite3Url, tempFile);

      // Extract the .node file - Use cross-platform approach
      // Note: tar is available on Windows 10+ and all Unix systems
      const isWindows = os.platform() === "win32";
      const tarCommand = isWindows
        ? `tar -xzf "${tempFile}" -C "${platformAssetsDir}"`
        : `tar -xzf ${tempFile} -C ${platformAssetsDir}`;

      try {
        execSync(tarCommand, { stdio: "pipe" });
      } catch (tarError) {
        console.warn(
          `  ⚠️  tar command failed, trying alternative extraction...`
        );
        // Fallback: Just note the issue, manual extraction may be needed
        console.warn(`  Download available at: ${tempFile}`);
      }

      // Clean up tar file
      await rm(tempFile, { force: true });

      console.log(`  ✅ better-sqlite3 binary ready for ${platform}`);
    } catch (error) {
      console.warn(
        `  ⚠️  Failed to download better-sqlite3 for ${platform}: ${error.message}`
      );
      console.warn(
        `  You may need to build it manually or copy from node_modules`
      );
    }
  }

  console.log("\n✅ better-sqlite3 binaries setup completed");
}

/**
 * Step 6: Download Platform-Specific Binaries (restic/rclone)
 */
async function downloadBinaries() {
  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("📦 Step 6: Downloading Platform-Specific Binaries");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  const binariesDir = join(rootDir, "dist", "binaries");
  await mkdir(binariesDir, { recursive: true });

  // Check if all binaries already exist
  let allBinariesExist = true;
  for (const [platform, config] of Object.entries(targets)) {
    const platformDir = join(binariesDir, config.binaryPlatform);
    const isWindows = config.binaryPlatform.startsWith("win32");
    const resticName = isWindows ? "restic.exe" : "restic";
    const rcloneName = isWindows ? "rclone.exe" : "rclone";

    const hasRestic = await fileExists(join(platformDir, resticName));
    const hasRclone = await fileExists(join(platformDir, rcloneName));

    if (!hasRestic || !hasRclone) {
      allBinariesExist = false;
      break;
    }
  }

  if (allBinariesExist) {
    console.log("✅ All binaries already exist, skipping download\n");
    console.log("💡 To force re-download, delete the dist/binaries folder");
    return;
  }

  for (const [platform, config] of Object.entries(targets)) {
    console.log(`\n🔧 Downloading binaries for ${platform}...`);

    const platformDir = join(binariesDir, config.binaryPlatform);
    await mkdir(platformDir, { recursive: true });

    const isWindows = config.binaryPlatform.startsWith("win32");
    const resticName = isWindows ? "restic.exe" : "restic";
    const rcloneName = isWindows ? "rclone.exe" : "rclone";

    // Download and extract restic
    const resticPath = join(platformDir, resticName);
    if (await fileExists(resticPath)) {
      console.log(`  ✓ restic already exists, skipping download`);
    } else {
      try {
        const resticTemp = join(binariesDir, `restic-${platform}.tmp`);
        await downloadFile(config.resticUrl, resticTemp);

        // Extract based on file type
        if (config.resticUrl.endsWith(".bz2")) {
          // Decompress bz2 (Unix)
          execSync(`bunzip2 -c "${resticTemp}" > "${resticPath}"`, {
            stdio: "pipe",
          });
          await rm(resticTemp, { force: true });
        } else if (config.resticUrl.endsWith(".zip")) {
          // Extract zip (Windows) using adm-zip for cross-platform support
          const zip = new AdmZip(resticTemp);
          const zipEntries = zip.getEntries();

          // Find the restic executable
          // Restic windows zip usually contains a versioned exe like restic_0.16.0_windows_amd64.exe
          let found = false;
          for (const entry of zipEntries) {
            if (
              entry.entryName.endsWith(".exe") &&
              entry.name.includes("restic")
            ) {
              zip.extractEntryTo(
                entry,
                dirname(resticPath),
                false,
                true,
                false,
                resticName
              );
              found = true;
              break;
            }
          }
          if (!found) {
            throw new Error("restic executable not found in zip archive");
          }
          await rm(resticTemp, { force: true });
        }

        // Set executable permissions on Unix
        if (
          !isWindows &&
          os.platform() !== "win32" &&
          (await fileExists(resticPath))
        ) {
          await chmod(resticPath, 0o755);
        }

        console.log(`  ✅ restic downloaded`);
      } catch (error) {
        console.error(
          `  ❌ Failed to download restic for ${platform}: ${error.message}`
        );
        throw new Error(
          `Failed to download restic for ${platform}: ${error.message}`
        );
      }
    }

    // Download and extract rclone
    const rclonePath = join(platformDir, rcloneName);
    if (await fileExists(rclonePath)) {
      console.log(`  ✓ rclone already exists, skipping download`);
    } else {
      try {
        const rcloneTemp = join(binariesDir, `rclone-${platform}.zip`);
        await downloadFile(config.rcloneUrl, rcloneTemp);

        // Extract zip using adm-zip for cross-platform support
        const zip = new AdmZip(rcloneTemp);
        const zipEntries = zip.getEntries();

        // Find the rclone executable (usually in a versioned folder)
        let found = false;
        for (const entry of zipEntries) {
          if (
            !entry.isDirectory &&
            (entry.name === "rclone.exe" || entry.name === "rclone")
          ) {
            zip.extractEntryTo(
              entry,
              dirname(rclonePath),
              false,
              true,
              false,
              rcloneName
            );
            found = true;
            break;
          }
        }
        if (!found) {
          throw new Error("rclone executable not found in zip archive");
        }
        await rm(rcloneTemp, { force: true });

        // Set executable permissions on Unix
        if (
          !isWindows &&
          os.platform() !== "win32" &&
          (await fileExists(rclonePath))
        ) {
          await chmod(rclonePath, 0o755);
        }

        console.log(`  ✅ rclone downloaded`);
      } catch (error) {
        console.error(
          `  ❌ Failed to download rclone for ${platform}: ${error.message}`
        );
        throw new Error(
          `Failed to download rclone for ${platform}: ${error.message}`
        );
      }
    }
  }

  console.log("\n✅ Binary downloads completed");
}

/**
 * Step 7: Generate Executables with pkg
 */
async function generateExecutables() {
  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("📦 Step 7: Generating Executables with pkg");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  const executablesDir = join(rootDir, "dist", "executables");
  const pkgBuildsDir = join(rootDir, "dist", "pkg-builds");

  // Ensure directories exist
  await mkdir(executablesDir, { recursive: true });
  await mkdir(pkgBuildsDir, { recursive: true });

  // Build pkg command with all targets
  const pkgTargets = Object.values(targets)
    .map((t) => t.pkgTarget)
    .join(",");
  // Use package.json as entry point so pkg reads the configuration (bin, pkg.scripts, etc.)
  const entryPoint = join(backendDir, "package.json");

  console.log(`\n🔨 Building executables for all platforms...`);
  console.log(`   Targets: ${pkgTargets}`);

  // Output to pkg-builds directory to avoid naming conflicts with distribution folders
  const pkgCommand = `npx pkg ${entryPoint} --targets ${pkgTargets} --output ${join(pkgBuildsDir, "pluton")} --compress GZip --public --public-packages "*" --options expose-gc --no-bytecode`;

  try {
    exec(pkgCommand, { cwd: rootDir });
    console.log("\n✅ All executables generated successfully");
  } catch (error) {
    console.error("\n❌ Failed to generate executables");
    throw error;
  }
}

/**
 * Step 8: Create Distribution Packages
 */
async function createDistributionPackages() {
  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("📦 Step 8: Creating Distribution Packages");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  const executablesDir = join(rootDir, "dist", "executables");
  const pkgBuildsDir = join(rootDir, "dist", "pkg-builds");
  const binariesDir = join(rootDir, "dist", "binaries");
  const pkgAssetsDir = join(rootDir, "dist", "pkg-assets");

  for (const [platform, config] of Object.entries(targets)) {
    console.log(`\n📦 Creating distribution package for ${platform}...`);

    const packageDir = join(executablesDir, `pluton-${platform}`);
    const packageBinariesDir = join(
      packageDir,
      "binaries",
      config.binaryPlatform
    );

    // Create package directory structure
    await mkdir(packageBinariesDir, { recursive: true });

    // Determine the source executable name generated by pkg
    // pkg might strip the node version from the filename or add .exe on Windows
    let executableSource = join(pkgBuildsDir, `pluton-${config.pkgTarget}`);

    // Check for variations if the exact target name doesn't exist
    if (!(await fileExists(executableSource))) {
      // Try with .exe extension (for Windows targets)
      if (await fileExists(executableSource + ".exe")) {
        executableSource += ".exe";
      }
      // Try without the node version (e.g. pluton-linux-x64 instead of pluton-node24-linux-x64)
      else {
        const simplifiedName = `pluton-${platform}`;
        const simplifiedSource = join(pkgBuildsDir, simplifiedName);

        if (await fileExists(simplifiedSource)) {
          executableSource = simplifiedSource;
        } else if (await fileExists(simplifiedSource + ".exe")) {
          executableSource = simplifiedSource + ".exe";
        }
      }
    }

    const executableDest = join(packageDir, config.executableName);

    if (await fileExists(executableSource)) {
      await copyFile(executableSource, executableDest);

      // Make executable on Unix systems (skip on Windows host)
      const isWindowsHost = os.platform() === "win32";
      if (!config.binaryPlatform.startsWith("win32") && !isWindowsHost) {
        try {
          await chmod(executableDest, 0o755);
        } catch (error) {
          console.warn(
            `  ⚠️  Could not set executable permissions: ${error.message}`
          );
        }
      }
      console.log(`  ✓ Copied executable`);
    } else {
      console.warn(`  ⚠️  Executable not found: ${executableSource}`);
    }

    // Copy better-sqlite3 native module
    const sqliteAssetsDir = join(pkgAssetsDir, platform, "better-sqlite3");
    if (await fileExists(sqliteAssetsDir)) {
      // The path structure better-sqlite3 expects is:
      // node_modules/better-sqlite3/build/Release/better_sqlite3.node
      // Our downloaded tarball extracts to build/Release/better_sqlite3.node

      const sqliteDestDir = join(
        packageDir,
        "node_modules",
        "better-sqlite3",
        "build",
        "Release"
      );
      await mkdir(sqliteDestDir, { recursive: true });

      // The source .node file is in build/Release/better_sqlite3.node
      const sourceNodeFile = join(
        sqliteAssetsDir,
        "build",
        "Release",
        "better_sqlite3.node"
      );
      const destNodeFile = join(sqliteDestDir, "better_sqlite3.node");

      if (await fileExists(sourceNodeFile)) {
        // Copy only the .node file to avoid nested build/Release/build/Release structure
        await copyFile(sourceNodeFile, destNodeFile);
      } else {
        // Fallback: check if .node file is directly in the assets dir
        const altSourceNodeFile = join(sqliteAssetsDir, "better_sqlite3.node");
        if (await fileExists(altSourceNodeFile)) {
          await copyFile(altSourceNodeFile, destNodeFile);
        } else {
          console.warn(
            `  ⚠️  better_sqlite3.node not found in expected locations`
          );
        }
      }

      console.log(`  ✓ Copied better-sqlite3 native module`);
    }

    // Copy binaries if they exist
    const sourceBinariesDir = join(binariesDir, config.binaryPlatform);
    if (await fileExists(sourceBinariesDir)) {
      await copyDirectory(sourceBinariesDir, packageBinariesDir);

      // Make binaries executable on Unix systems (skip on Windows host)
      const isWindowsHost = os.platform() === "win32";
      if (!config.binaryPlatform.startsWith("win32") && !isWindowsHost) {
        const resticPath = join(packageBinariesDir, "restic");
        const rclonePath = join(packageBinariesDir, "rclone");

        if (await fileExists(resticPath)) {
          await chmod(resticPath, 0o755);
        }
        if (await fileExists(rclonePath)) {
          await chmod(rclonePath, 0o755);
        }
      }

      console.log(`  ✓ Copied binaries for ${config.binaryPlatform}`);
    } else {
      console.warn(
        `  ⚠️  Binaries not found for ${config.binaryPlatform} at ${sourceBinariesDir}`
      );
    }

    // Copy README and LICENSE
    const readme = join(rootDir, "README.md");
    const license = join(rootDir, "LICENSE");

    if (await fileExists(readme)) {
      await copyFile(readme, join(packageDir, "README.md"));
    }
    if (await fileExists(license)) {
      await copyFile(license, join(packageDir, "LICENSE"));
    }

    // Copy drizzle migrations folder
    const drizzleSrc = join(backendDir, "drizzle");
    const drizzleDest = join(packageDir, "drizzle");
    if (await fileExists(drizzleSrc)) {
      await copyDirectory(drizzleSrc, drizzleDest);
      console.log(`  ✓ Copied drizzle migrations`);
    } else {
      console.warn(`  ⚠️  Drizzle migrations not found at ${drizzleSrc}`);
    }

    console.log(`✅ Distribution package created: pluton-${platform}/`);
  }

  console.log("\n✅ All distribution packages created successfully");
  console.log(`\n📁 Packages location: ${executablesDir}`);
}

/**
 * Main Build Process
 */
async function main() {
  try {
    const startTime = Date.now();

    await buildFrontend();
    await copyFrontendToBackend();
    await installBackendDeps();
    await compileBackend();
    await setupBetterSqlite3();
    await downloadBinaries();
    await generateExecutables();
    await createDistributionPackages();

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);

    console.log(
      "\n╔═══════════════════════════════════════════════════════════╗"
    );
    console.log(
      "║   ✅ Build Completed Successfully!                        ║"
    );
    console.log(
      "╚═══════════════════════════════════════════════════════════╝"
    );
    console.log(`\n⏱️  Total build time: ${duration}s`);
    console.log(
      `📁 Distribution packages: ${join(rootDir, "dist", "executables")}\n`
    );

    console.log("📋 Next steps:");
    console.log("   1. Test executables on target platforms");
    console.log(
      "   2. Create installers (Windows Inno Setup, Linux/macOS scripts)"
    );
    console.log("   3. Sign executables (optional but recommended)");
    console.log("   4. Create release packages/archives\n");
  } catch (error) {
    console.error(
      "\n╔═══════════════════════════════════════════════════════════╗"
    );
    console.error(
      "║   ❌ Build Failed!                                        ║"
    );
    console.error(
      "╚═══════════════════════════════════════════════════════════╝\n"
    );
    console.error(error);
    process.exit(1);
  }
}

// Run the build
main();
