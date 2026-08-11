// @ts-check
const { defineConfig, devices } = require('@playwright/test');

const CHROMIUM = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

module.exports = defineConfig({
  testDir: './tests',
  timeout: 30_000,
  retries: 0,
  reporter: 'line',
  use: {
    baseURL: 'http://localhost:9000',
  },
  projects: [
    {
      name: 'desktop',
      use: {
        viewport: { width: 1280, height: 800 },
        launchOptions: { executablePath: CHROMIUM },
      },
    },
    {
      name: 'mobile',
      use: {
        viewport: { width: 375, height: 812 },
        isMobile: true,
        launchOptions: { executablePath: CHROMIUM },
      },
    },
  ],
});
