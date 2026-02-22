import { defineConfig } from '@playwright/test';

export default defineConfig({
    testDir: './e2e',
    timeout: 30_000,
    retries: process.env.CI ? 1 : 0,
    use: {
        baseURL: 'http://localhost:5173',
        trace: 'retain-on-failure',
    },
    webServer: {
        command: 'bun desktop:web',
        port: 5173,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
    },
});
