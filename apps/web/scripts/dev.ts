/** Run the Hono API (hot reload) and the Vite dev server together. Ctrl+C stops both. */
const here = import.meta.dir;
const cwd = `${here}/..`;
const api = Bun.spawn(['bun', '--hot', 'server/index.ts'], { cwd, stdio: ['inherit', 'inherit', 'inherit'] });
const ui = Bun.spawn(['bunx', 'vite', '--host', '127.0.0.1'], { cwd, stdio: ['inherit', 'inherit', 'inherit'] });
const stop = () => {
  api.kill();
  ui.kill();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
await Promise.race([api.exited, ui.exited]);
stop();
