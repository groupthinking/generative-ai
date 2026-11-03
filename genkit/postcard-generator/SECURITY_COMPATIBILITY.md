# Security and Genkit compatibility

Next 15.5.28, Sharp 0.35.5 and PostCSS 8.5.23 are resolved and validated on Node 22. The Genkit packages are aligned on 1.0.4 because the previous manifest required Genkit 1 while its lock resolved 0.9.12. The source uses the Genkit 1 instance, prompt and response APIs; authentication is checked before model execution and lazy telemetry startup. Image/text generation and map prompt behavior remain covered by the flow tests. Firebase server headers are awaited for Next15.

The scoped Jaeger 2.9 propagator override fixes malformed-percent header handling while retaining the existing OpenTelemetry 1 NodeTracerProvider. Actual provider injection/extraction, baggage handling and malformed headers are covered by the regression test. The optional Winston transport build warning remains visible.

## Developer runtime and ZIP dependency repair

The former `npx genkit@latest start` command fails because `genkit` is a runtime library without an executable. The repaired command uses exact `genkit-cli 1.45.0` and `tsx 4.23.15` pins and imports the existing flow module. The runtime, core, Vertex AI, Google Cloud and Ollama packages remain aligned at 1.0.4. The CLI and runtime have separate release versions; actual HTTP discovery and execution through the CLI's RuntimeManager pass the regression tests. This demonstrates the tested integration, not an upstream guarantee for every CLI feature. The original `gemini-2.0-flash` prompt model is explicitly registered through Vertex AI's supported `models` option, without replacing the selected model.

CLI 1.45.0 removes the `extract-zip` dependency introduced by 1.44.1. The complete frozen lock and installed dependency tree no longer contain it. The two high symlink traversal advisories [GHSA-jmr9-qjv8-65gv](https://github.com/advisories/GHSA-jmr9-qjv8-65gv) and [GHSA-7pqw-9j4j-h8q3](https://github.com/advisories/GHSA-7pqw-9j4j-h8q3) are absent from the refreshed audit. Comparing the previous patched-Next candidate and this candidate against the same current advisory service removes those two advisory IDs and adds no new advisory IDs.

The actual UI asset downloader still uses `adm-zip 0.6.1`. Tools-common 1.45.0 now declares `^0.6.1` itself, so the previous scoped override outside its declared 0.5 range is removed. Tests execute the real downloader's cached archive extraction, verify a preexisting symlink cannot overwrite an external file, and exercise malformed compressed input error handling. All three assertions remain intact.

## Remaining security hold

Full security approval remains blocked by [GHSA-mrhx-c7xc-m3w5](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5). Runtime Genkit and its OpenAI dependency use Zod 3.25.76; CLI 1.45.0, tools-common and telemetry-server also pin Zod 3.25.67. The latest inspected Genkit core 1.43.0 still declares Zod 3. A forced Zod 4 override has not been used because it changes Genkit's schema API and JSON-schema translation contract.

The complete audits on 2026-11-03 report the following package records. The production-only columns are supplementary diagnostics; the full audit remains the security gate.

| Candidate | Full: critical / high / moderate | Production only: critical / high / moderate |
| --- | --- | --- |
| Previous patched-Next candidate, CLI 1.44.1 | 0 / 8 / 86 | 0 / 3 / 67 |
| Current patched-Next candidate, CLI 1.45.0 | 0 / 10 / 84 | 0 / 5 / 65 |
| Current draft prerequisite at Next 15.4.7 | 1 / 12 / 84 | 1 / 7 / 65 |

All six audits have zero low findings. These are package records, including propagated parent findings, rather than counts of independent vulnerabilities. Although the ZIP advisories are removed, the full high-package count increases: `@genkit-ai/ai`, `genkit` and the CLI's nested `zod-to-json-schema` are now reported as high through the existing Zod advisory, while the `extract-zip` high record is removed. The earlier initial CLI repair had reported 8 high and 63 moderate findings, versus 3 high and 63 moderate before that developer repair. None of these counts establishes security closure. No audit allowlist, development-dependency exclusion from the gate, removed developer feature or forced Zod 4 override is used.

The preexisting gRPC override mismatch is corrected with an override scoped to the cloud trace exporter, matching its already installed 1.14.6. The existing global 1.13.6 override remains for the Firebase consumer. The complete lockfile and runtime package versions remain byte-for-byte unchanged. A clean frozen install and the full `npm ls --all` check now pass on both candidates. This declaration repair does not fix the Zod audit findings or establish security readiness.

## Validation scope

On Node 22.23.4 with npm 10.9.9, both postcard variants pass frozen installation without manifest/lock changes, all 10 tests, TypeScript, lint, a complete four-page production build and actual PNG optimization at their respective frozen Next/Sharp versions. The initial production builds failed in Next's Google Fonts URL parser; one unchanged retry per candidate passed. No font substitution, mocked font response, skipped build or application change was used to obtain the passing result.

The tests use real Genkit schemas, plugins, prompts, reflection and CLI routing, with controlled external provider adapters and temporary CLI settings. They verify authentication ordering, input rejection before adapters, selected models, Maps/prompt/image output, Jaeger handling and ZIP safety. They do not prove downloaded UI rendering, live Maps/Vertex AI/Ollama availability, model quality, cloud authentication or production deployment.

The original Next-only scope finding is resolved by the separate compatibility prerequisite: the stacked security PR retains the seven-file Next closure. The prerequisite remains a draft with the deliberately older Next versions and must not be merged or deployed as the finished security repair.
