/**
 * Copyright 2024 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

"use strict";
import { GoogleAuth } from "google-auth-library";
import { genkit } from "genkit";
import { logger } from "genkit/logging";
import { vertexAI } from "@genkit-ai/vertexai";
import { ollama } from "genkitx-ollama";
import { enableGoogleCloudTelemetry } from "@genkit-ai/google-cloud";
import { AlwaysOnSampler } from "@opentelemetry/sdk-trace-base";

logger.setLogLevel("debug");

let auth: GoogleAuth;

function getAuthClient() {
  // Lazy load GoogleAuth client.
  if (!auth) {
    auth = new GoogleAuth();
  }
  return auth;
}

export async function getIdToken(url: string): Promise<string> {
  const auth = getAuthClient();
  const client = await auth.getIdTokenClient(url);
  return client.idTokenProvider.fetchIdToken(url);
}

// Match the telemetry options used by the previous configuration, initialized
// only when the shared flow runs (builds do not need cloud credentials).
let telemetryReady: Promise<void> | undefined;
export function initializeGenkitTelemetry(): Promise<void> {
  return telemetryReady ??= enableGoogleCloudTelemetry({
    forceDevExport: true,
    sampler: new AlwaysOnSampler(),
    autoInstrumentation: true,
    autoInstrumentationConfig: {
      "@opentelemetry/instrumentation-fs": { enabled: false },
      "@opentelemetry/instrumentation-dns": { enabled: true },
      "@opentelemetry/instrumentation-net": { enabled: true },
    },
  });
}

export const ai = genkit({
  plugins: [
    // Register the original prompt model explicitly; Genkit 1.0.4
    // advertises the versioned -001 model by default, not this alias.
    vertexAI({ location: "europe-west2", models: ["gemini-2.0-flash"] }),
    ollama({
      models: [{ name: process.env.OLLAMA_MODEL_NAME || "gemma2:9b" }],
      serverAddress:
        process.env.OLLAMA_SERVER_ADDRESS || "http://127.0.0.1:8080",
      requestHeaders: async (params) => ({
        Authorization: `Bearer ${await getIdToken(params.serverAddress)}`,
      }),
    }),
  ],
});
