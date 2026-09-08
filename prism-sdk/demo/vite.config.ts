import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    // the demo imports the SDK source from ../src — allow serving it
    fs: { allow: ["../.."] },
  },
});