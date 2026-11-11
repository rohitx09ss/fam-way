import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";

const pages = ["index", "login", "transactions", "payment-links", "api-keys", "webhooks", "integrations", "accounts", "profile", "docs", "pay"];
const file = (p) => fileURLToPath(new URL(`./${p}.html`, import.meta.url));

export default defineConfig({
  build: { rollupOptions: { input: Object.fromEntries(pages.map((p) => [p, file(p)])) } },
});
