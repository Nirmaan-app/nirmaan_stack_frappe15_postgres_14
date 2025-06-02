import { defineConfig } from "cypress";

export default defineConfig({
  e2e: {
    baseUrl: 'http://localhost:8080',
    pageLoadTimeout: 30000,
    
    // viewportHeight: 1080,
    // viewportWidth: 1920,
    
    video:false,
    videoCompression: 32,
  },
  env: {
    login_Email: "Administrator",
    login_Password: "avisekkr"
  },
  defaultCommandTimeout: 20000,
});
