# Security and Genkit compatibility

Next 15.5.28, Sharp 0.35.5 and PostCSS 8.5.23 are resolved and validated on Node 22. The Genkit packages are aligned on 1.0.4 because the previous manifest required Genkit 1 while its lock resolved 0.9.12. The source uses the Genkit 1 instance, prompt and response APIs; authentication is checked before model execution and lazy telemetry startup. Image/text generation and map prompt behavior remain covered by the flow tests. Firebase server headers are awaited for Next15.

The scoped Jaeger 2.9 propagator override fixes malformed-percent header handling while retaining the existing OpenTelemetry 1 NodeTracerProvider. Actual provider injection/extraction, baggage handling and malformed headers are covered by the regression test. Native frozen install, tests, full TypeScript validation, production Next build and actual PNG optimization pass. The optional Winston transport build warning remains visible.

Full security approval remains blocked by GHSA-mrhx-c7xc-m3w5: Genkit and its OpenAI dependency still use Zod 3.25.76. Before the developer command repair, the full audit reported 3 high and 63 moderate findings. The first full audit after adding the pinned CLI reported 8 high and 63 moderate findings. The refreshed complete-candidate audit reports **8 high and 86 moderate findings**; its production-only audit reports **3 high and 67 moderate findings**, both with no critical/low findings. These are package audit records, including propagated parent findings, rather than counts of independent vulnerabilities. The additional high package records are described below; this is an explicitly disclosed regression in dependency exposure, not security closure. At the earlier registry check, Genkit 1.43 still declared Zod 3, so upgrading Genkit alone does not close this advisory. A forced Zod 4 override has not been used because it changes Genkit's schema API and JSON-schema translation contract. Do not label this package audit-clean.


## Developer runtime repair and additional security hold

The former `npx genkit@latest start` command fails because `genkit` is a runtime
library without an executable. The repaired command uses exact `genkit-cli 1.44.1`
and `tsx 4.23.15` pins and imports the existing flow module. The runtime, core,
Vertex, Google Cloud and Ollama packages remain aligned at 1.0.4. The CLI and
runtime have separate release versions; their actual HTTP discovery and execution
protocol is covered through the CLI's RuntimeManager in the regression tests.
This demonstrates the tested integration, not an upstream guarantee for every
CLI feature. The original `gemini-2.0-flash` prompt model is explicitly registered
through Vertex's supported `models` option, without replacing the selected model.

CLI 1.44.1 introduces tools-common/telemetry-server and their Zod 3 consumers.
It also declares `extract-zip 2.0.1`, whose two high symlink traversal advisories
[GHSA-jmr9-qjv8-65gv](https://github.com/advisories/GHSA-jmr9-qjv8-65gv) and
[GHSA-7pqw-9j4j-h8q3](https://github.com/advisories/GHSA-7pqw-9j4j-h8q3) have no
published patched version at the validation date. The package remains in the
lock and audit. Inspection of the published CLI distribution finds its manifest
dependency but no runtime import of extract-zip; that bounded observation does
not remove the version finding or establish general non-reachability.

The current UI asset downloader uses `adm-zip`. A scoped tools-common override
selects 0.6.1, outside its declared 0.5 range, to address the ZIP advisories. Tests
execute the actual downloader's cached archive extraction, verify a preexisting
symlink cannot overwrite an external file, and exercise malformed compressed
input error handling. This compatibility evidence applies to that consumer.
The unchanged high hold now includes Zod 3 and extract-zip; no audit allowlist,
forced Zod 4 override, removed import or removed developer feature was used.

The smoke tests use real Genkit schemas, plugins, prompts, reflection and CLI
routing, with controlled external provider adapters and temporary CLI settings.
They do not prove downloaded UI rendering, live Maps/Vertex/Ollama availability,
model quality, cloud authentication or production deployment. The original
Next-only lockfile-scope review thread also needs explicit scope reconciliation
before this expanded compatibility candidate can be approved.
