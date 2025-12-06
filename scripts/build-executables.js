import { execSync } from "child_process";
import { readdir, mkdir, copyFile, rm, access, chmod } from "fs/promises";
import { join, dirname, resolve } from "path";
import { fileURLToPath } from "url";
import { constants } from "fs";
import https from "https";
import fs from "fs";
import { createWriteStream } from "fs";
import os from "os";
import compressing from "compressing";
import unbzip2Stream from "unbzip2-stream";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = resolve(__dirname, "..");
const backendDir = resolve(rootDir, "backend");
const frontendDir = resolve(rootDir, "frontend");

// Parse command line arguments for output name
// Usage: node build-executables.js [--name <output-name>]
// Example: node build-executables.js --name pluton-pro
const args = process.argv.slice(2);
const nameIndex = args.indexOf("--name");
const OUTPUT_NAME =
  nameIndex !== -1 && args[nameIndex + 1] ? args[nameIndex + 1] : "pluton";

console.log("╔═══════════════════════════════════════════════════════════╗");
console.log("║   🚀 Pluton Multi-Platform Executable Build Script       ║");
console.log("╚═══════════════════════════════════════════════════════════╝\n");
console.log(`📛 Output name: ${OUTPUT_NAME}\n`);

// Version configuration - Update these to use latest versions
const BETTER_SQLITE3_VERSION = "12.4.4"; // Latest: Check https://github.com/WiseLibs/better-sqlite3/releases
const RESTIC_VERSION = "0.18.1"; // Latest: Check https://github.com/restic/restic/releases
const RCLONE_VERSION = "1.71.2"; // Latest: Check https://rclone.org/downloads/
const KEYRING_VERSION = "1.2.0"; // Latest: Check https://www.npmjs.com/package/@napi-rs/keyring

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
    keyringPackage: `@napi-rs/keyring-win32-x64-msvc`,
    keyringNodeFile: `keyring.win32-x64-msvc.node`,
  },
  "linux-x64": {
    pkgTarget: "node24-linux-x64",
    executableName: "pluton",
    binaryPlatform: "linux-x64",
    nodeVersion: "24",
    betterSqlite3Url: `https://github.com/WiseLibs/better-sqlite3/releases/download/v${BETTER_SQLITE3_VERSION}/better-sqlite3-v${BETTER_SQLITE3_VERSION}-node-v137-linux-x64.tar.gz`,
    resticUrl: `https://github.com/restic/restic/releases/download/v${RESTIC_VERSION}/restic_${RESTIC_VERSION}_linux_amd64.bz2`,
    rcloneUrl: `https://downloads.rclone.org/v${RCLONE_VERSION}/rclone-v${RCLONE_VERSION}-linux-amd64.zip`,
    keyringPackage: `@napi-rs/keyring-linux-x64-gnu`,
    keyringNodeFile: `keyring.linux-x64-gnu.node`,
  },
  "linux-arm64": {
    pkgTarget: "node24-linux-arm64",
    executableName: "pluton",
    binaryPlatform: "linux-arm64",
    nodeVersion: "24",
    betterSqlite3Url: `https://github.com/WiseLibs/better-sqlite3/releases/download/v${BETTER_SQLITE3_VERSION}/better-sqlite3-v${BETTER_SQLITE3_VERSION}-node-v137-linux-arm64.tar.gz`,
    resticUrl: `https://github.com/restic/restic/releases/download/v${RESTIC_VERSION}/restic_${RESTIC_VERSION}_linux_arm64.bz2`,
    rcloneUrl: `https://downloads.rclone.org/v${RCLONE_VERSION}/rclone-v${RCLONE_VERSION}-linux-arm64.zip`,
    keyringPackage: `@napi-rs/keyring-linux-arm64-gnu`,
    keyringNodeFile: `keyring.linux-arm64-gnu.node`,
  },
  "macos-x64": {
    pkgTarget: "node24-macos-x64",
    executableName: "pluton",
    binaryPlatform: "darwin-x64",
    nodeVersion: "24",
    betterSqlite3Url: `https://github.com/WiseLibs/better-sqlite3/releases/download/v${BETTER_SQLITE3_VERSION}/better-sqlite3-v${BETTER_SQLITE3_VERSION}-node-v137-darwin-x64.tar.gz`,
    resticUrl: `https://github.com/restic/restic/releases/download/v${RESTIC_VERSION}/restic_${RESTIC_VERSION}_darwin_amd64.bz2`,
    rcloneUrl: `https://downloads.rclone.org/v${RCLONE_VERSION}/rclone-v${RCLONE_VERSION}-osx-amd64.zip`,
    keyringPackage: `@napi-rs/keyring-darwin-x64`,
    keyringNodeFile: `keyring.darwin-x64.node`,
  },
  "macos-arm64": {
    pkgTarget: "node24-macos-arm64",
    executableName: "pluton",
    binaryPlatform: "darwin-arm64",
    nodeVersion: "24",
    betterSqlite3Url: `https://github.com/WiseLibs/better-sqlite3/releases/download/v${BETTER_SQLITE3_VERSION}/better-sqlite3-v${BETTER_SQLITE3_VERSION}-node-v137-darwin-arm64.tar.gz`,
    resticUrl: `https://github.com/restic/restic/releases/download/v${RESTIC_VERSION}/restic_${RESTIC_VERSION}_darwin_arm64.bz2`,
    rcloneUrl: `https://downloads.rclone.org/v${RCLONE_VERSION}/rclone-v${RCLONE_VERSION}-osx-arm64.zip`,
    keyringPackage: `@napi-rs/keyring-darwin-arm64`,
    keyringNodeFile: `keyring.darwin-arm64.node`,
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
 * Step 1: Install Dependencies
 */
async function installDependencies() {
  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(
    "📦 Step 1: Install Dependencies",
    process.env.USE_LOCAL_CORE ? "(Skipped)" : ""
  );
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
  // FOR PRO: If USE_LOCAL_CORE is set, skip installing dependencies
  // As it breaks the linking to local core packages
  if (!process.env.USE_LOCAL_CORE) {
    exec("pnpm install", { cwd: rootDir });
    console.log("✅ Dependencies installed");
  }
}

/**
 * Step 2: Build Frontend
 */
async function buildFrontend() {
  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("📦 Step 2: Building Frontend");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  exec("pnpm run build", { cwd: frontendDir });

  console.log("✅ Frontend build completed");
}

/**
 * Step 3: Copy Frontend Build to Backend
 */
async function copyFrontendToBackend() {
  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("📦 Step 3: Copying Frontend Build to Backend");
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
 * Step 4: Compile TypeScript Backend
 */
async function compileBackend() {
  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("📦 Step 4: Compiling TypeScript Backend");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  exec("pnpm run build:pkg", {
    cwd: backendDir,
    env: { USE_LOCAL_CORE: process.env.USE_LOCAL_CORE }, // USE_LOCAL_CORE for build:pkg script (for PRO local development)
  });

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
 * Step 5b: Download and Setup @napi-rs/keyring Native Binaries
 */
async function setupKeyring() {
  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("📦 Step 5b: Setting up @napi-rs/keyring Native Binaries");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  const pkgAssetsDir = join(rootDir, "dist", "pkg-assets");
  await mkdir(pkgAssetsDir, { recursive: true });

  // Check if all keyring binaries already exist (caching)
  let allKeyringBinariesExist = true;
  for (const [platform, config] of Object.entries(targets)) {
    const keyringNodePath = join(
      pkgAssetsDir,
      platform,
      "keyring",
      config.keyringNodeFile
    );
    if (!(await fileExists(keyringNodePath))) {
      allKeyringBinariesExist = false;
      break;
    }
  }

  if (allKeyringBinariesExist) {
    console.log("✅ All keyring binaries already exist, skipping download\n");
    console.log(
      "💡 To force re-download, delete the dist/pkg-assets/*/keyring folders"
    );
    return;
  }

  for (const [platform, config] of Object.entries(targets)) {
    console.log(`\n🔧 Setting up @napi-rs/keyring for ${platform}...`);

    const keyringDir = join(pkgAssetsDir, platform, "keyring");
    const keyringNodePath = join(keyringDir, config.keyringNodeFile);

    // Skip if already exists (individual platform caching)
    if (await fileExists(keyringNodePath)) {
      console.log(
        `  ✓ keyring already exists for ${platform}, skipping download`
      );
      continue;
    }

    await mkdir(keyringDir, { recursive: true });

    try {
      // Use npm pack to download the platform-specific package
      const tempDir = join(pkgAssetsDir, `keyring-temp-${platform}`);
      await mkdir(tempDir, { recursive: true });

      // Download and extract the npm package
      console.log(
        `  ⬇️  Downloading ${config.keyringPackage}@${KEYRING_VERSION}...`
      );
      execSync(`npm pack ${config.keyringPackage}@${KEYRING_VERSION}`, {
        cwd: tempDir,
        stdio: "pipe",
      });

      // Find the downloaded tarball
      const files = await readdir(tempDir);
      const tarball = files.find((f) => f.endsWith(".tgz"));

      if (!tarball) {
        throw new Error("Could not find downloaded tarball");
      }

      // Extract the tarball
      const tarballPath = join(tempDir, tarball);
      const isWindows = os.platform() === "win32";
      const tarCommand = isWindows
        ? `tar -xzf "${tarballPath}" -C "${tempDir}"`
        : `tar -xzf ${tarballPath} -C ${tempDir}`;

      execSync(tarCommand, { stdio: "pipe" });

      // Find and copy the .node file
      const packageDir = join(tempDir, "package");
      const nodeFile = join(packageDir, config.keyringNodeFile);

      if (await fileExists(nodeFile)) {
        await copyFile(nodeFile, keyringNodePath);
        console.log(`  ✅ keyring binary ready for ${platform}`);
      } else {
        throw new Error(`Could not find ${config.keyringNodeFile} in package`);
      }

      // Clean up temp directory
      await rm(tempDir, { recursive: true, force: true });
    } catch (error) {
      console.warn(
        `  ⚠️  Failed to download keyring for ${platform}: ${error.message}`
      );
      console.warn(`  Keyring functionality may not work on this platform`);
    }
  }

  console.log("\n✅ @napi-rs/keyring binaries setup completed");
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
          // Decompress bz2 using unbzip2-stream (cross-platform, pure JS)
          await new Promise((resolve, reject) => {
            const input = fs.createReadStream(resticTemp);
            const output = fs.createWriteStream(resticPath);
            input.pipe(unbzip2Stream()).pipe(output);
            output.on("finish", resolve);
            output.on("error", reject);
            input.on("error", reject);
          });
          await rm(resticTemp, { force: true });
        } else if (config.resticUrl.endsWith(".zip")) {
          // Extract zip to temp directory, then find and move the executable
          const extractDir = join(binariesDir, `restic-${platform}-extract`);
          await compressing.zip.uncompress(resticTemp, extractDir);

          // Find the restic executable in the extracted files
          const files = await readdir(extractDir, { recursive: true });
          let found = false;
          for (const file of files) {
            const fileName = typeof file === "string" ? file : file.name;
            // Normalize path separators and get base name
            const normalizedPath = fileName.replace(/\\/g, "/");
            const baseName = normalizedPath.split("/").pop();

            if (baseName === "restic" || baseName === "restic.exe") {
              const srcFile = join(extractDir, fileName);
              const stat = await fs.promises.stat(srcFile);
              if (stat.isFile()) {
                await copyFile(srcFile, resticPath);
                found = true;
                break;
              }
            }
          }

          if (!found) {
            throw new Error("restic executable not found in zip archive");
          }

          await rm(extractDir, { recursive: true, force: true });
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

        // Extract zip using compressing package (cross-platform)
        const extractDir = join(binariesDir, `rclone-${platform}-extract`);
        await compressing.zip.uncompress(rcloneTemp, extractDir);

        // Find the rclone executable (usually in a versioned folder like rclone-v1.71.2-linux-amd64/)
        const files = await readdir(extractDir, { recursive: true });
        let found = false;
        for (const file of files) {
          const fileName = typeof file === "string" ? file : file.name;
          // Normalize path separators and get base name
          const normalizedPath = fileName.replace(/\\/g, "/");
          const baseName = normalizedPath.split("/").pop();

          if (baseName === "rclone" || baseName === "rclone.exe") {
            const srcFile = join(extractDir, fileName);
            const stat = await fs.promises.stat(srcFile);
            if (stat.isFile()) {
              await copyFile(srcFile, rclonePath);
              found = true;
              break;
            }
          }
        }

        if (!found) {
          throw new Error("rclone executable not found in zip archive");
        }

        await rm(extractDir, { recursive: true, force: true });
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
  console.log(`   Output name: ${OUTPUT_NAME}`);

  // Output to pkg-builds directory to avoid naming conflicts with distribution folders
  const pkgCommand = `npx pkg ${entryPoint} --targets ${pkgTargets} --output ${join(pkgBuildsDir, OUTPUT_NAME)} --compress GZip --public --public-packages "*" --options expose-gc --no-bytecode`;

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

    const packageDir = join(executablesDir, `${OUTPUT_NAME}-${platform}`);
    const packageBinariesDir = join(
      packageDir,
      "binaries",
      config.binaryPlatform
    );

    // Create package directory structure
    await mkdir(packageBinariesDir, { recursive: true });

    // Determine the source executable name generated by pkg
    // pkg might strip the node version from the filename or add .exe on Windows
    let executableSource = join(
      pkgBuildsDir,
      `${OUTPUT_NAME}-${config.pkgTarget}`
    );

    // Check for variations if the exact target name doesn't exist
    if (!(await fileExists(executableSource))) {
      // Try with .exe extension (for Windows targets)
      if (await fileExists(executableSource + ".exe")) {
        executableSource += ".exe";
      }
      // Try without the node version (e.g. pluton-linux-x64 instead of pluton-node24-linux-x64)
      else {
        const simplifiedName = `${OUTPUT_NAME}-${platform}`;
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

    // Copy @napi-rs/keyring native module
    const keyringAssetsDir = join(pkgAssetsDir, platform, "keyring");
    const keyringSourceFile = join(keyringAssetsDir, config.keyringNodeFile);
    if (await fileExists(keyringSourceFile)) {
      // The path structure @napi-rs/keyring expects is:
      // node_modules/@napi-rs/keyring-<platform>/keyring.<platform>.node
      const keyringDestDir = join(
        packageDir,
        "node_modules",
        "@napi-rs",
        config.keyringPackage.replace("@napi-rs/", "")
      );
      await mkdir(keyringDestDir, { recursive: true });

      const keyringDestFile = join(keyringDestDir, config.keyringNodeFile);
      await copyFile(keyringSourceFile, keyringDestFile);

      console.log(`  ✓ Copied @napi-rs/keyring native module`);
    } else {
      console.warn(`  ⚠️  keyring native module not found for ${platform}`);
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

    console.log(`✅ Distribution package created: ${OUTPUT_NAME}-${platform}/`);
  }

  console.log("\n✅ All distribution packages created successfully");
  console.log(`\n📁 Packages location: ${executablesDir}`);
}

/**
 * Step 9: Create Linux Tarballs for Release
 */
async function createLinuxTarballs() {
  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("📦 Step 9: Creating Linux Tarballs for Release");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  const executablesDir = join(rootDir, "dist", "executables");
  const installersDir = join(rootDir, "dist", "installers");

  // Ensure installers directory exists
  await mkdir(installersDir, { recursive: true });

  // Define Linux targets to compress
  const linuxTargets = ["linux-x64", "linux-arm64"];

  for (const platform of linuxTargets) {
    const sourceDir = join(executablesDir, `${OUTPUT_NAME}-${platform}`);
    const tarballName = `${OUTPUT_NAME}-${platform}.tar.gz`;
    const tarballPath = join(installersDir, tarballName);

    // Check if source directory exists
    if (!(await fileExists(sourceDir))) {
      console.warn(`  ⚠️  Source directory not found: ${sourceDir}`);
      continue;
    }

    console.log(`\n🔧 Creating tarball for ${platform}...`);
    console.log(`   Source: ${sourceDir}`);
    console.log(`   Output: ${tarballPath}`);

    try {
      // Use tar command (available on Windows 10+ and all Unix systems)
      // We need to cd to the executables dir so the tarball contains the folder name
      const isWindows = os.platform() === "win32";
      const folderName = `${OUTPUT_NAME}-${platform}`;

      // Create tarball with the folder as root
      const tarCommand = isWindows
        ? `tar -czf "${tarballPath}" -C "${executablesDir}" "${folderName}"`
        : `tar -czf "${tarballPath}" -C "${executablesDir}" "${folderName}"`;

      execSync(tarCommand, { stdio: "pipe" });

      // Get file size for display
      const stats = await fs.promises.stat(tarballPath);
      const sizeMB = (stats.size / (1024 * 1024)).toFixed(2);

      console.log(`  ✅ Created ${tarballName} (${sizeMB} MB)`);
    } catch (error) {
      console.error(
        `  ❌ Failed to create tarball for ${platform}: ${error.message}`
      );
      throw error;
    }
  }

  console.log("\n✅ Linux tarballs created successfully");
  console.log(`📁 Tarballs location: ${installersDir}`);
}

/**
 * Main Build Process
 */
async function main() {
  try {
    const startTime = Date.now();

    await installDependencies();
    await buildFrontend();
    await copyFrontendToBackend();
    await compileBackend();
    await setupBetterSqlite3();
    await setupKeyring();
    await downloadBinaries();
    await generateExecutables();
    await createDistributionPackages();
    await createLinuxTarballs();

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
