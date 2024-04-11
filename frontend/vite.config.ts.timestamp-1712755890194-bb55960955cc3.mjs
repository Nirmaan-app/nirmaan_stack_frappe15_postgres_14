var __getOwnPropNames = Object.getOwnPropertyNames;
var __commonJS = (cb, mod) => function __require() {
  return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
};

// ../../../sites/common_site_config.json
var require_common_site_config = __commonJS({
  "../../../sites/common_site_config.json"(exports, module) {
    module.exports = {
      allow_cors: "*",
      background_workers: 1,
      db_host: "postgresql",
      db_type: "postgres",
      developer_mode: 1,
      file_watcher_port: 6787,
      frappe_types_pause_generation: 0,
      frappe_user: "frappe",
      gunicorn_workers: 9,
      ignore_csrf: 1,
      live_reload: true,
      rebase_on_pull: false,
      redis_cache: "redis://redis-cache:6379",
      redis_queue: "redis://redis-queue:6379",
      redis_socketio: "redis://redis-queue:6379",
      restart_supervisor_on_update: false,
      restart_systemd_on_update: false,
      serve_default_site: true,
      shallow_clone: true,
      socketio_port: 9e3,
      use_redis_auth: false,
      webserver_port: 8e3
    };
  }
});

// vite.config.ts
import path from "path";
import { defineConfig } from "file:///workspace/development/frappe-bench/apps/nirmaan_stack/frontend/node_modules/vite/dist/node/index.js";
import react from "file:///workspace/development/frappe-bench/apps/nirmaan_stack/frontend/node_modules/@vitejs/plugin-react/dist/index.mjs";

// proxyOptions.ts
var common_site_config = require_common_site_config();
var { webserver_port } = common_site_config;
var proxyOptions_default = {
  "^/(app|api|assets|files|private)": {
    target: `http://127.0.0.1:${webserver_port}`,
    ws: true,
    router: function(req) {
      const site_name = req.headers.host.split(":")[0];
      return `http://${site_name}:${webserver_port}`;
    }
  }
};

// vite.config.ts
var __vite_injected_original_dirname = "/workspace/development/frappe-bench/apps/nirmaan_stack/frontend";
var vite_config_default = defineConfig({
  plugins: [react()],
  server: {
    port: 8080,
    proxy: proxyOptions_default
  },
  resolve: {
    alias: {
      "@": path.resolve(__vite_injected_original_dirname, "src")
    }
  },
  build: {
    outDir: "../nirmaan_stack/public/frontend",
    emptyOutDir: true,
    target: "es2015"
  }
});
export {
  vite_config_default as default
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsiLi4vLi4vLi4vc2l0ZXMvY29tbW9uX3NpdGVfY29uZmlnLmpzb24iLCAidml0ZS5jb25maWcudHMiLCAicHJveHlPcHRpb25zLnRzIl0sCiAgInNvdXJjZXNDb250ZW50IjogWyJ7XG4gXCJhbGxvd19jb3JzXCI6IFwiKlwiLFxuIFwiYmFja2dyb3VuZF93b3JrZXJzXCI6IDEsXG4gXCJkYl9ob3N0XCI6IFwicG9zdGdyZXNxbFwiLFxuIFwiZGJfdHlwZVwiOiBcInBvc3RncmVzXCIsXG4gXCJkZXZlbG9wZXJfbW9kZVwiOiAxLFxuIFwiZmlsZV93YXRjaGVyX3BvcnRcIjogNjc4NyxcbiBcImZyYXBwZV90eXBlc19wYXVzZV9nZW5lcmF0aW9uXCI6IDAsXG4gXCJmcmFwcGVfdXNlclwiOiBcImZyYXBwZVwiLFxuIFwiZ3VuaWNvcm5fd29ya2Vyc1wiOiA5LFxuIFwiaWdub3JlX2NzcmZcIjogMSxcbiBcImxpdmVfcmVsb2FkXCI6IHRydWUsXG4gXCJyZWJhc2Vfb25fcHVsbFwiOiBmYWxzZSxcbiBcInJlZGlzX2NhY2hlXCI6IFwicmVkaXM6Ly9yZWRpcy1jYWNoZTo2Mzc5XCIsXG4gXCJyZWRpc19xdWV1ZVwiOiBcInJlZGlzOi8vcmVkaXMtcXVldWU6NjM3OVwiLFxuIFwicmVkaXNfc29ja2V0aW9cIjogXCJyZWRpczovL3JlZGlzLXF1ZXVlOjYzNzlcIixcbiBcInJlc3RhcnRfc3VwZXJ2aXNvcl9vbl91cGRhdGVcIjogZmFsc2UsXG4gXCJyZXN0YXJ0X3N5c3RlbWRfb25fdXBkYXRlXCI6IGZhbHNlLFxuIFwic2VydmVfZGVmYXVsdF9zaXRlXCI6IHRydWUsXG4gXCJzaGFsbG93X2Nsb25lXCI6IHRydWUsXG4gXCJzb2NrZXRpb19wb3J0XCI6IDkwMDAsXG4gXCJ1c2VfcmVkaXNfYXV0aFwiOiBmYWxzZSxcbiBcIndlYnNlcnZlcl9wb3J0XCI6IDgwMDBcbn0iLCAiY29uc3QgX192aXRlX2luamVjdGVkX29yaWdpbmFsX2Rpcm5hbWUgPSBcIi93b3Jrc3BhY2UvZGV2ZWxvcG1lbnQvZnJhcHBlLWJlbmNoL2FwcHMvbmlybWFhbl9zdGFjay9mcm9udGVuZFwiO2NvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9maWxlbmFtZSA9IFwiL3dvcmtzcGFjZS9kZXZlbG9wbWVudC9mcmFwcGUtYmVuY2gvYXBwcy9uaXJtYWFuX3N0YWNrL2Zyb250ZW5kL3ZpdGUuY29uZmlnLnRzXCI7Y29uc3QgX192aXRlX2luamVjdGVkX29yaWdpbmFsX2ltcG9ydF9tZXRhX3VybCA9IFwiZmlsZTovLy93b3Jrc3BhY2UvZGV2ZWxvcG1lbnQvZnJhcHBlLWJlbmNoL2FwcHMvbmlybWFhbl9zdGFjay9mcm9udGVuZC92aXRlLmNvbmZpZy50c1wiO2ltcG9ydCBwYXRoIGZyb20gJ3BhdGgnO1xuaW1wb3J0IHsgZGVmaW5lQ29uZmlnIH0gZnJvbSAndml0ZSc7XG5pbXBvcnQgcmVhY3QgZnJvbSAnQHZpdGVqcy9wbHVnaW4tcmVhY3QnXG5pbXBvcnQgcHJveHlPcHRpb25zIGZyb20gJy4vcHJveHlPcHRpb25zJztcblxuLy8gaHR0cHM6Ly92aXRlanMuZGV2L2NvbmZpZy9cbmV4cG9ydCBkZWZhdWx0IGRlZmluZUNvbmZpZyh7XG5cdHBsdWdpbnM6IFtyZWFjdCgpXSxcblx0c2VydmVyOiB7XG5cdFx0cG9ydDogODA4MCxcblx0XHRwcm94eTogcHJveHlPcHRpb25zXG5cdH0sXG5cdHJlc29sdmU6IHtcblx0XHRhbGlhczoge1xuXHRcdFx0J0AnOiBwYXRoLnJlc29sdmUoX19kaXJuYW1lLCAnc3JjJylcblx0XHR9XG5cdH0sXG5cdGJ1aWxkOiB7XG5cdFx0b3V0RGlyOiAnLi4vbmlybWFhbl9zdGFjay9wdWJsaWMvZnJvbnRlbmQnLFxuXHRcdGVtcHR5T3V0RGlyOiB0cnVlLFxuXHRcdHRhcmdldDogJ2VzMjAxNScsXG5cdH0sXG59KTtcbiIsICJjb25zdCBfX3ZpdGVfaW5qZWN0ZWRfb3JpZ2luYWxfZGlybmFtZSA9IFwiL3dvcmtzcGFjZS9kZXZlbG9wbWVudC9mcmFwcGUtYmVuY2gvYXBwcy9uaXJtYWFuX3N0YWNrL2Zyb250ZW5kXCI7Y29uc3QgX192aXRlX2luamVjdGVkX29yaWdpbmFsX2ZpbGVuYW1lID0gXCIvd29ya3NwYWNlL2RldmVsb3BtZW50L2ZyYXBwZS1iZW5jaC9hcHBzL25pcm1hYW5fc3RhY2svZnJvbnRlbmQvcHJveHlPcHRpb25zLnRzXCI7Y29uc3QgX192aXRlX2luamVjdGVkX29yaWdpbmFsX2ltcG9ydF9tZXRhX3VybCA9IFwiZmlsZTovLy93b3Jrc3BhY2UvZGV2ZWxvcG1lbnQvZnJhcHBlLWJlbmNoL2FwcHMvbmlybWFhbl9zdGFjay9mcm9udGVuZC9wcm94eU9wdGlvbnMudHNcIjtjb25zdCBjb21tb25fc2l0ZV9jb25maWcgPSByZXF1aXJlKCcuLi8uLi8uLi9zaXRlcy9jb21tb25fc2l0ZV9jb25maWcuanNvbicpO1xuY29uc3QgeyB3ZWJzZXJ2ZXJfcG9ydCB9ID0gY29tbW9uX3NpdGVfY29uZmlnO1xuXG5leHBvcnQgZGVmYXVsdCB7XG5cdCdeLyhhcHB8YXBpfGFzc2V0c3xmaWxlc3xwcml2YXRlKSc6IHtcblx0XHR0YXJnZXQ6IGBodHRwOi8vMTI3LjAuMC4xOiR7d2Vic2VydmVyX3BvcnR9YCxcblx0XHR3czogdHJ1ZSxcblx0XHRyb3V0ZXI6IGZ1bmN0aW9uKHJlcSkge1xuXHRcdFx0Y29uc3Qgc2l0ZV9uYW1lID0gcmVxLmhlYWRlcnMuaG9zdC5zcGxpdCgnOicpWzBdO1xuXHRcdFx0cmV0dXJuIGBodHRwOi8vJHtzaXRlX25hbWV9OiR7d2Vic2VydmVyX3BvcnR9YDtcblx0XHR9XG5cdH1cbn07XG4iXSwKICAibWFwcGluZ3MiOiAiOzs7Ozs7QUFBQTtBQUFBO0FBQUE7QUFBQSxNQUNDLFlBQWM7QUFBQSxNQUNkLG9CQUFzQjtBQUFBLE1BQ3RCLFNBQVc7QUFBQSxNQUNYLFNBQVc7QUFBQSxNQUNYLGdCQUFrQjtBQUFBLE1BQ2xCLG1CQUFxQjtBQUFBLE1BQ3JCLCtCQUFpQztBQUFBLE1BQ2pDLGFBQWU7QUFBQSxNQUNmLGtCQUFvQjtBQUFBLE1BQ3BCLGFBQWU7QUFBQSxNQUNmLGFBQWU7QUFBQSxNQUNmLGdCQUFrQjtBQUFBLE1BQ2xCLGFBQWU7QUFBQSxNQUNmLGFBQWU7QUFBQSxNQUNmLGdCQUFrQjtBQUFBLE1BQ2xCLDhCQUFnQztBQUFBLE1BQ2hDLDJCQUE2QjtBQUFBLE1BQzdCLG9CQUFzQjtBQUFBLE1BQ3RCLGVBQWlCO0FBQUEsTUFDakIsZUFBaUI7QUFBQSxNQUNqQixnQkFBa0I7QUFBQSxNQUNsQixnQkFBa0I7QUFBQSxJQUNuQjtBQUFBO0FBQUE7OztBQ3ZCK1csT0FBTyxVQUFVO0FBQ2hZLFNBQVMsb0JBQW9CO0FBQzdCLE9BQU8sV0FBVzs7O0FDRitWLElBQU0scUJBQXFCO0FBQzVZLElBQU0sRUFBRSxlQUFlLElBQUk7QUFFM0IsSUFBTyx1QkFBUTtBQUFBLEVBQ2Qsb0NBQW9DO0FBQUEsSUFDbkMsUUFBUSxvQkFBb0IsY0FBYztBQUFBLElBQzFDLElBQUk7QUFBQSxJQUNKLFFBQVEsU0FBUyxLQUFLO0FBQ3JCLFlBQU0sWUFBWSxJQUFJLFFBQVEsS0FBSyxNQUFNLEdBQUcsRUFBRSxDQUFDO0FBQy9DLGFBQU8sVUFBVSxTQUFTLElBQUksY0FBYztBQUFBLElBQzdDO0FBQUEsRUFDRDtBQUNEOzs7QURaQSxJQUFNLG1DQUFtQztBQU16QyxJQUFPLHNCQUFRLGFBQWE7QUFBQSxFQUMzQixTQUFTLENBQUMsTUFBTSxDQUFDO0FBQUEsRUFDakIsUUFBUTtBQUFBLElBQ1AsTUFBTTtBQUFBLElBQ04sT0FBTztBQUFBLEVBQ1I7QUFBQSxFQUNBLFNBQVM7QUFBQSxJQUNSLE9BQU87QUFBQSxNQUNOLEtBQUssS0FBSyxRQUFRLGtDQUFXLEtBQUs7QUFBQSxJQUNuQztBQUFBLEVBQ0Q7QUFBQSxFQUNBLE9BQU87QUFBQSxJQUNOLFFBQVE7QUFBQSxJQUNSLGFBQWE7QUFBQSxJQUNiLFFBQVE7QUFBQSxFQUNUO0FBQ0QsQ0FBQzsiLAogICJuYW1lcyI6IFtdCn0K
