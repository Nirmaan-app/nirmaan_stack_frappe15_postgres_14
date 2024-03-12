import path from 'path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react'
import proxyOptions from './proxyOptions';

// https://vitejs.dev/config/
export default defineConfig({
	plugins: [react()],
	server: {
		port: 8080,
		proxy: proxyOptions
	},
	resolve: {
		alias: {
			'@': path.resolve(__dirname, 'src'),
			'tailwind.config.js': path.resolve(__dirname, 'tailwind.config.js'),
		}
	},
	build: {
		outDir: '../nirmaan_stack/public/frontend',
		emptyOutDir: true,
		commonjsOptions: {
      		include: [/tailwind.config.js/, /node_modules/],
    	},
    	sourcemap: true,
	},
});
