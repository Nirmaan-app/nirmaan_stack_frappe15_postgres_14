import path from 'path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react'
import proxyOptions from './proxyOptions';
import { VitePWA } from 'vite-plugin-pwa';

// https://vitejs.dev/config/
export default defineConfig({
	plugins: [react(), VitePWA({registerType: 'autoUpdate'})],
	optimizeDeps: {
		include: ['@radix-ui/react-radio-group']
	},
	server: {
		port: 8080,
		proxy: proxyOptions,
		// host: '0.0.0.0'
	},
	resolve: {
		alias: {
			'@': path.resolve(__dirname, 'src')
		}
	},
	build: {
		outDir: '../nirmaan_stack/public/frontend',
		emptyOutDir: true,
		target: 'es2015',
		rollupOptions: {
			onwarn(warning, warn) {
				if (warning.code === 'MODULE_LEVEL_DIRECTIVE') {
					return
				}
				warn(warning)
			}
		}
	},
});
