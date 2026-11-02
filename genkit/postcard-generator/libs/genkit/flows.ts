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
"use server";
import { renderMap } from "@/libs/maps/maps";
import {
  PostcardResult,
  PostcardFlow,
  PostcardFlowSchema,
  PostcardResultSchema,
  PostcardMapLLMRequestSchema,
  PostcardImageLLMRequestSchema,
  PostcardMapLLMResponseSchema,
} from "./schema";
import { ai, initializeGenkitTelemetry } from "./config";
import { headers } from "next/headers";
import { getAuth, DecodedIdToken } from "firebase-admin/auth";
import { firebaseServerApp } from "@/libs/firebase/serverApp";

// Is auth enabled?
const authEnabled = process.env.AUTH_ENABLED?.toLowerCase() !== "false";

/**
 * Create a postcard using Google Maps, Gemini, and Imagen 3. Should not be called
 * directly from clients, instead route through callPostcardFlow
 *
 * @see callPostcardFlow
 * @see PostcardFlowSchema
 * @see PostcardResultSchema
 */
const postcardFlow = ai.defineFlow(
  {
    name: "Postcard Flow",
    inputSchema: PostcardFlowSchema,
    outputSchema: PostcardResultSchema,
  },
  async (postcard: PostcardFlow) => {
    // The web action authenticates before invoking this shared flow. The local
    // Genkit developer runtime invokes the same flow through its dev tools.
    await initializeGenkitTelemetry();
    // Get a map image of the whole journey and store it as a data URL
    const mapImage = await renderMap(
      postcard.start,
      postcard.end,
      postcard.stops,
    );
    const mapUrl = `data:image/png;base64,${mapImage}`;

    // Load postcard map multi-modal prompt (for map image & text)
    const mapPrompt = ai.prompt<
      typeof PostcardMapLLMRequestSchema,
      typeof PostcardMapLLMResponseSchema
    >("postcard-map");

    // Send the map image and address details to the model and generate a response in the desired schema
    const readMapResponse = await mapPrompt({
      start: postcard.start,
      end: postcard.end,
      mapImage: mapUrl,
      sender: postcard.sender,
      recipient: postcard.recipient,
    });

    // Map response has a structured output
    const mapResponse = readMapResponse.output!;

    // Load the image generation prompt
    const postcardPrompt = ai.prompt<typeof PostcardImageLLMRequestSchema>("postcard-image");
    // Generate an image - it should populate the media output
    const imagenResponse = await postcardPrompt({
      start: postcard.start,
      end: postcard.end,
      story: readMapResponse.text,
    });

    // Combine outputs from both LLM responses into an object to return
    return {
      description: mapResponse.description,
      story: mapResponse.story,
      image: imagenResponse.media?.url || "",
      map: mapUrl,
    } as PostcardResult;
  },
);

/**
 * Provides a direct calling point from the client. Must verify auth headers if authentication is enabled.
 * @see PostcardFlowSchema
 * @see PostcardResultSchema
 * @param args Configuration for the postcard.
 * @returns The generated postcard image, story, and map
 */
export async function callPostcardFlow(
  args: PostcardFlow,
): Promise<PostcardResult> {
  // Check auth headers
  if (authEnabled) {
    // We don't care about the return value here, just if it throws an error or not.
    await verifyToken(await headers());
  }
  // Call the flow once authorized
  return await postcardFlow(args);
}

/**
 * Check if an Authorization header is present and valid.
 * @param authHeader The Authorization header passed
 * @returns the DecodedIdToken for the valid user - or throws an error
 */
export async function verifyToken(headers: Headers): Promise<DecodedIdToken> {
  // Verify the token - we don't care about the result - it will throw an error
  // if the token is invalid
  const authHeader = headers.get("Authorization");

  if (!authHeader) {
    throw new Error("Missing Authorization Header");
  }

  if (authHeader.length > 7) {
    // Chop "Bearer " from the header
    const token = authHeader.substring(7);
    // This will throw an error if the token is not valid
    return await getAuth(firebaseServerApp).verifyIdToken(token);
  }
  throw new Error("No token present");
}
