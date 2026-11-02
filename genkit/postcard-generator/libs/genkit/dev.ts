/** Register the same postcard flow used by the Next.js server action. */
import { config as loadEnvironment } from "dotenv";

loadEnvironment({ path: process.env.ENV_FILE_LOCATION || ".env" });

async function start(): Promise<void> {
  if (process.env.GENKIT_ENV !== "dev") {
    throw new Error("Start this runtime with npm run genkit:dev");
  }
  // Import after environment loading. Registration must not require a Next.js
  // request or execute a paid model call; the existing Maps key check remains.
  await import("./flows");
}

start().catch((error: unknown) => {
  console.error("Unable to start the postcard Genkit runtime:", error);
  process.exit(1);
});
