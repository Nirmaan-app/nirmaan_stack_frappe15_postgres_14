import { defineConfig } from "cypress";

export default defineConfig({
  e2e: {
    baseUrl: 'http://localhost:8080',
    viewportHeight: 1080,
    viewportWidth: 1920,
  },
});
