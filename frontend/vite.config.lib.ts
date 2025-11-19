import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';
import { copyFileSync, mkdirSync, readdirSync, statSync } from 'fs';
import { join, dirname } from 'path';

// Plugin to copy SCSS files to dist
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
               } else if (entry.endsWith('.scss')) {
                  mkdirSync(dirname(distPath), { recursive: true });
                  copyFileSync(srcPath, distPath);
               }
            });
         };

         // Copy SCSS files from src to dist
         copyScssFiles(resolve(__dirname, 'src'), resolve(__dirname, 'dist'));
         console.log('✓ SCSS files copied to dist');
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
      outDir: 'dist',
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
         generateScopedName: '[name]__[local]___[hash:base64:5]',
      },
   },
   resolve: {
      alias: {
         '@': resolve(__dirname, './src'),
      },
   },
}));
