import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve, basename } from 'path';
import { copyFileSync, mkdirSync, readdirSync, statSync } from 'fs';
import { createHash } from 'crypto';
import { join, dirname } from 'path';

// Plugin to copy non-module SCSS files to dist-lib
// Module SCSS files are NOT copied because they're pre-compiled to .module.scss.js
// with consistent hashes. Only utility/mixin SCSS files are copied for @use/@extend.
// NOTE: core-frontend.css is excluded because Vite generates it with all compiled CSS modules.
function copyScssPlugin() {
   return {
      name: 'copy-scss',
      writeBundle() {
         const copyScssFiles = (srcDir: string, distDir: string) => {
            const entries = readdirSync(srcDir);
            entries.forEach((entry) => {
               const srcPath = join(srcDir, entry);
               const distPath = join(distDir, entry);

               if (statSync(srcPath).isDirectory()) {
                  copyScssFiles(srcPath, distPath);
               } else if (entry.endsWith('.png')) {
                  // Always copy images
                  mkdirSync(dirname(distPath), { recursive: true });
                  copyFileSync(srcPath, distPath);
               } else if (entry.endsWith('.scss') || entry.endsWith('.css')) {
                  // Skip .module.scss files - they have pre-compiled .js mappings
                  // Only copy utility SCSS files (mixins, variables, placeholders)
                  // Also skip core-frontend.css - Vite generates this with compiled CSS modules
                  if (!entry.includes('.module.') && entry !== 'core-frontend.css') {
                     mkdirSync(dirname(distPath), { recursive: true });
                     copyFileSync(srcPath, distPath);
                  }
               }
            });
         };

         // Copy non-module SCSS files from src to dist-lib
         copyScssFiles(resolve(__dirname, 'src'), resolve(__dirname, 'dist-lib'));
         console.log('✓ Non-module SCSS/CSS/PNG files copied to dist-lib');
      },
   };
}

// https://vite.dev/config/
export default defineConfig(({ command, mode }) => ({
   plugins: [react(), copyScssPlugin()],
   build: {
      lib: {
         entry: {
            index: resolve(__dirname, 'src/index.ts'),
            components: resolve(__dirname, 'src/components/index.ts'),
            services: resolve(__dirname, 'src/services/index.ts'),
            hooks: resolve(__dirname, 'src/hooks/index.ts'),
            utils: resolve(__dirname, 'src/utils/index.ts'),
            context: resolve(__dirname, 'src/context/index.ts'),
            routes: resolve(__dirname, 'src/routes/index.ts'),
            router: resolve(__dirname, 'src/router.tsx'),
         },
         name: 'PlutoCore',
         formats: ['es'],
      },
      rollupOptions: {
         // Externalize dependencies that shouldn't be bundled
         external: [
            'react',
            'react-dom',
            'react/jsx-runtime',
            'react-router',
            '@tanstack/react-query',
            '@tanstack/react-query-devtools',
            'react-toastify',
            'react-tooltip',
            'react-window',
            'comlink',
            'dexie',
            'marked',
            'nanoid',
            /^virtual:/, // Exclude all virtual modules (like PWA)
         ],
         output: {
            // Preserve module structure
            preserveModules: true,
            preserveModulesRoot: 'src',
            exports: 'named',
            // Provide global variables for UMD build
            globals: {
               react: 'React',
               'react-dom': 'ReactDOM',
               'react/jsx-runtime': 'jsxRuntime',
               'react-router': 'ReactRouter',
               '@tanstack/react-query': 'ReactQuery',
            },
            assetFileNames: (assetInfo) => {
               // Keep asset structure
               if (assetInfo.name?.endsWith('.css')) {
                  return 'styles/[name][extname]';
               }
               if (assetInfo.name?.match(/\.(png|jpe?g|svg|gif|webp)$/)) {
                  return 'assets/images/[name][extname]';
               }
               if (assetInfo.name?.match(/\.(woff2?|eot|ttf|otf)$/)) {
                  return 'assets/fonts/[name][extname]';
               }
               return 'assets/[name][extname]';
            },
         },
      },
      sourcemap: true,
      // Generate CSS file
      cssCodeSplit: false,
      outDir: 'dist-lib',
      emptyOutDir: command === 'build', // Only empty in build mode, not watch
      watch: command === 'serve' ? {} : null,
   },
   css: {
      preprocessorOptions: {
         scss: {
            api: 'modern',
         },
      },
      modules: {
         localsConvention: 'camelCase',
         // Use content-based hash that's deterministic regardless of file path
         // This ensures the same hash is generated in library build and consumer builds
         generateScopedName: (name, filename, css) => {
            // Use only the filename (not full path) + class name + css content for hash
            const file = basename(filename).replace(/\.module\.s?css$/, '');
            const hash = createHash('md5').update(`${file}_${name}_${css}`).digest('base64').slice(0, 5).replace(/[+/=]/g, 'x');
            return `_${name}_${hash}`;
         },
      },
   },
   resolve: {
      alias: {
         '@': resolve(__dirname, './src'),
      },
   },
}));
