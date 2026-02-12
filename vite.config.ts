import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import fs from 'fs';

function angularResourcesPlugin() {
  return {
    name: 'vite-plugin-angular-resources',
    async resolveId(id: string) {
      if (id.includes('.component.html') || id.includes('.component.css')) {
        return this.resolve(id);
      }
    },
    async load(id: string) {
      if (id.includes('.component.html') || id.includes('.component.css')) {
        return fs.readFileSync(id, 'utf-8');
      }
    },
    async transform(code: string, id: string) {
      if (id.includes('.component.ts') && code.includes('templateUrl:')) {
        const templateUrlMatch = code.match(/templateUrl:\s*['"`]([^'"``]+)['"`]/);
        if (templateUrlMatch) {
          const templatePath = templateUrlMatch[1];
          const resolvedPath = path.resolve(path.dirname(id), templatePath);
          try {
            const template = fs.readFileSync(resolvedPath, 'utf-8')
              .replace(/\/\//g, '\\\\//') 
              .replace(/`/g, '\\`');
            const escapedTemplate = template.split('\n').map(line => line.trimRight()).join('\\n');
            code = code.replace(
              /templateUrl:\s*['"`][^'"``]+['"`]/,
              `template: \`${escapedTemplate}\``
            );
          } catch (e) {
            console.warn(`Could not load template: ${resolvedPath}`);
          }
        }
      }
      return code;
    }
  };
}

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');
    return {
      server: {
        port: 3000,
        host: '0.0.0.0',
        proxy: {
          '/api/llm': {
            target: 'http://127.0.0.1:1234',
            changeOrigin: true,
            rewrite: (path) => path.replace(/^\/api\/llm/, ''),
            ws: false,
          },
        },
      },
      css: {
        postcss: './postcss.config.js',
      },
      plugins: [angularResourcesPlugin()],
      define: {
        'process.env.API_KEY': JSON.stringify(env.GEMINI_API_KEY),
        'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY),
        'process.env.LOCAL_ENDPOINT': JSON.stringify(env.LOCAL_ENDPOINT || 'http://127.0.0.1:1234'),
      },
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      }
    };
});
