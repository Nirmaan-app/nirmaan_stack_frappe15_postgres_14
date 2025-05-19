import path from 'path';
import fs from 'fs';

function getCommonSiteConfig(): { webserver_port?: number; socketio_port?: number } | null {
  let currentDir = path.resolve('.')
  // traverse up till we find frappe-bench with sites directory
  while (currentDir !== '/') {
    if (
      fs.existsSync(path.join(currentDir, 'sites')) &&
      fs.existsSync(path.join(currentDir, 'apps'))
    ) {
      let configPath = path.join(currentDir, 'sites', 'common_site_config.json')
      if (fs.existsSync(configPath)) {
        // return JSON.parse(fs.readFileSync(configPath))
        try {
            const rawConfig = fs.readFileSync(configPath, 'utf-8');
            return JSON.parse(rawConfig);
        } catch (error) {
            console.error(`Error reading or parsing common_site_config.json at ${configPath}:`, error);
            // Return null or default ports if parsing fails
            return null;
      }
      }
      return null
    }
    currentDir = path.resolve(currentDir, '..')
  }
  return null
}

const config = getCommonSiteConfig()
const webserver_port = config ? config.webserver_port : 8000

// Define the socket.io port (default is 9000)
const socketio_port = config ? config.socketio_port : 9000; // You might want to add socketio_port to common_site_config.json if it differs

if (!config) {
  console.warn('No common_site_config.json found or it was invalid, using default ports: web=8000, socketio=9000');
} else {
  console.log(`Proxy using ports: web=${webserver_port}, socketio=${socketio_port}`);
}

// Define types for better clarity (optional but good practice)
interface ProxyOptions {
  target: string;
  ws?: boolean;
  changeOrigin?: boolean;
  secure?: boolean;
  rewrite?: (path: string) => string;
  configure?: (proxy: any, options: any) => void;
  onError?: (err: Error, req: any, res: any) => void;
  onProxyReqWs?: (proxyReq: any, req: any, socket: any, options: any, head: any) => void;
}

const proxyConfig: Record<string, ProxyOptions> = {
	'^/(app|api|assets|files|private)': {
		target: `http://127.0.0.1:${webserver_port}`,
		ws: true,
		changeOrigin: true,
		secure: false,
		// router: function(req) {
		// 	const site_name = req.headers.host.split(':')[0];
		// 	return `http://${site_name}:${webserver_port}`;
		// },
    rewrite: (path) => path,
    configure: (proxy, options) => {
      proxy.on('proxyReq', (proxyReq, req, res) => {
        const hostHeader = req.headers.host || '';
        // Set the Host header correctly for Frappe multi-tenancy if needed
        const site_name = hostHeader.includes(':') ? hostHeader.split(':')[0] : hostHeader;

        const targetSite = site_name || '127.0.0.1'; 
         proxyReq.setHeader('X-Frappe-Site-Name', targetSite);
         // You might also need to set the Host header if Frappe relies on it
         // proxyReq.setHeader('Host', `${site_name}:${webserver_port}`);
      });
      proxy.on('error', (err, req, res) => { // Add specific error logging for API proxy
        console.error(`API Proxy Error for ${req.url}:`, err);
   });

    }
	},

  // *** Add rule for Socket.IO ***
  '^/socket.io': {
    target: `http://127.0.0.1:${socketio_port}`, // Target the Socket.IO server
    ws: true,        // IMPORTANT: Enable WebSocket proxying
    changeOrigin: true,
    secure: false,
    // No router needed usually for socket.io, it connects to the base URL
    // Log errors for debugging
    // onError: (err, req, res) => {
    //     console.error('Socket.IO Proxy Error:', err);
    //     if (!res.headersSent) {
    //         res.writeHead(500, { 'Content-Type': 'text/plain' });
    //     }
    //     res.end('Socket.IO Proxy Error');
    // },
    onError: (err, req, res) => {
      console.error(`Socket.IO Proxy Error for ${req.url}:`, err);
      // Ensure headers aren't already sent before trying to write head/end
      if (res && typeof res.writeHead === 'function' && !res.headersSent) {
          res.writeHead(500, { 'Content-Type': 'text/plain' });
      }
       if (res && typeof res.end === 'function' && !res.writableEnded) {
          res.end('Socket.IO Proxy Error');
      }
  },
   onProxyReqWs: (proxyReq, req, socket, options, head) => { // Add logging for WS proxying
       const hostHeader = req.headers.host || '';
       const site_name = hostHeader.includes(':') ? hostHeader.split(':')[0] : hostHeader;
       const targetSite = site_name || '127.0.0.1';
       proxyReq.setHeader('X-Frappe-Site-Name', targetSite); // Pass site name for WS too
       // console.log(`Proxying WebSocket request for site: ${targetSite}`); // Debug logging
   }
  }
};

export default proxyConfig;
