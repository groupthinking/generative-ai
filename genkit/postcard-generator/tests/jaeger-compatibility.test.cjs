const test = require('node:test');
const assert = require('node:assert/strict');
const { NodeTracerProvider } = require('@opentelemetry/sdk-trace-node');
const { trace, propagation, context, ROOT_CONTEXT, defaultTextMapGetter, defaultTextMapSetter } = require('@opentelemetry/api');

test('Genkit telemetry SDK preserves Jaeger trace propagation and ignores malformed headers', async () => {
  const previous = process.env.OTEL_PROPAGATORS;
  process.env.OTEL_PROPAGATORS = 'jaeger';
  const provider = new NodeTracerProvider();
  provider.register();
  try {
    const span = { traceId: '12345678901234567890123456789012', spanId: '1234567890123456', traceFlags: 1 };
    const carrier = {};
    propagation.inject(trace.setSpanContext(ROOT_CONTEXT, span), carrier, defaultTextMapSetter);
    const restored = trace.getSpanContext(propagation.extract(ROOT_CONTEXT, carrier, defaultTextMapGetter));
    assert.equal(restored.traceId, span.traceId);
    assert.equal(restored.spanId, span.spanId);
    assert.equal(restored.traceFlags, span.traceFlags);
    assert.doesNotThrow(() => propagation.extract(ROOT_CONTEXT, { 'uber-trace-id': '%' }, defaultTextMapGetter));
    assert.doesNotThrow(() => propagation.extract(ROOT_CONTEXT, { 'uberctx-user': '%' }, defaultTextMapGetter));
    const baggageContext = propagation.extract(ROOT_CONTEXT, { 'uberctx-user': 'alice%20bob' }, defaultTextMapGetter);
    assert.equal(propagation.getBaggage(baggageContext).getEntry('user').value, 'alice bob');
  } finally {
    await provider.shutdown();
    trace.disable(); propagation.disable(); context.disable();
    if (previous === undefined) delete process.env.OTEL_PROPAGATORS;
    else process.env.OTEL_PROPAGATORS = previous;
  }
});
