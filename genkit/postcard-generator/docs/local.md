# Running Locally

## Requirements

### Environment Requirements

1. Node.js 20.9+ (Node 22 is used for validation)

### Dependencies

Note: These dependencies can be automated by following the [deployment instructions](deploy.md).

1. A Google Cloud Project with Billing, Vertex enabled
2. A [Google Maps API key](https://developers.google.com/maps/documentation/embed/get-api-key). This is required for autocomplete, routing, and static map generation
3. Vertex AI enabled in your project

## Configuration

### Environment Variables

Copy `.env.example` to `.env` and populate it. The most important thing is a maps API key.

### Node Dependency Installation

Install genkit and Next.js dependencies:

```sh
npm ci
```

## Development Servers

### Genkit

To start a genkit server, run the following:

```sh
npm run genkit:dev
```

This uses the lockfile's pinned `genkit-cli` and `tsx` executables. The runtime
loads the configured environment file, then imports `libs/genkit/flows.ts`, the
same flow module used by the web application. The Genkit console is available
on [localhost:4000](http://localhost:4000) (or the next free port printed by the
CLI). The first launch downloads the matching UI assets and presents the CLI's
analytics notice; internet access is required for that download. Select **Postcard Flow** to inspect its schema and run it. The Vertex and
Ollama plugins and existing prompt files remain available.

Registration does not run the map or model calls. Running a flow does use the
configured Maps, Vertex/Ollama and telemetry services, so retain the credentials
and project setup above. The developer tools are trusted local development
services; they invoke the flow directly, outside the web application's Firebase
request-authentication boundary. Do not expose their ports to an untrusted
network. The old `genkit-tools.conf.js` harness configuration is retained for
reference; the explicit runtime command is what registers the current flow.

Stop the development command with Ctrl-C. `npm test` includes a real CLI and
registration and CLI-to-runtime API smoke test plus controlled provider adapters
that exercise the existing prompts without paid service calls. These checks do
not exercise the downloaded browser UI or call live cloud services. This does not replace
testing with your actual cloud credentials.

### Next.js

To start a Next.js development server, run the following:

```sh
npm run dev
```

You can access this on [localhost:3000](http://localhost:3000)
