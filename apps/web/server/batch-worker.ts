/// <reference lib="webworker" />
import { type BatchConfig, type StrategyDoc, compileStrategy, runBatch } from '@crapola/engine';

declare const self: Worker;

interface StartMessage {
  doc: StrategyDoc;
  config: Omit<BatchConfig, 'onProgress'>;
}

self.onmessage = (event: MessageEvent<StartMessage>) => {
  const { doc, config } = event.data;
  try {
    const strategy = compileStrategy(doc);
    let last = 0;
    const batch = runBatch(strategy, {
      ...config,
      onProgress: (done, total) => {
        const now = performance.now();
        if (done === total || now - last > 100) {
          last = now;
          self.postMessage({ type: 'progress', done, total });
        }
      },
    });
    self.postMessage({ type: 'done', summary: batch.summary, results: batch.results, elapsedMs: batch.elapsedMs });
  } catch (err) {
    self.postMessage({ type: 'error', message: err instanceof Error ? err.message : String(err) });
  }
};
