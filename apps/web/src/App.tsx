import { match, useRoute } from './router.ts';
import { ImportPage } from './pages/ImportPage.tsx';
import { RunDetailPage } from './pages/RunDetail.tsx';
import { RunPage } from './pages/RunPage.tsx';
import { RunsHistory } from './pages/RunsHistory.tsx';
import { Strategies } from './pages/Strategies.tsx';
import { StrategyEditor } from './pages/StrategyEditor.tsx';

const NAV = [
  { href: '#/', label: 'Strategies', test: (p: string) => p === '/' || p.startsWith('/strategies') },
  { href: '#/run', label: 'Run', test: (p: string) => p === '/run' },
  { href: '#/runs', label: 'Results', test: (p: string) => p.startsWith('/runs') },
  { href: '#/import', label: 'Import', test: (p: string) => p === '/import' },
];

export function App() {
  const route = useRoute();
  const { path, query } = route;

  let page: React.ReactNode;
  let m: Record<string, string> | null;
  if (path === '/' || path === '/strategies') page = <Strategies />;
  else if (path === '/strategies/new') page = <StrategyEditor key="new" id={null} />;
  else if ((m = match('/strategies/:id', path))) page = <StrategyEditor key={m.id} id={m.id!} />;
  else if (path === '/run') page = <RunPage query={query} />;
  else if (path === '/runs') page = <RunsHistory />;
  else if ((m = match('/runs/:id', path))) page = <RunDetailPage key={m.id} id={m.id!} />;
  else if (path === '/import') page = <ImportPage query={query} />;
  else page = <div className="empty">Nothing at {path}</div>;

  return (
    <div className="shell">
      <header className="topbar">
        <a className="brand" href="#/">
          <span className="dice" aria-hidden>
            ⚃⚂
          </span>
          Crapola
        </a>
        <nav className="nav">
          {NAV.map((n) => (
            <a key={n.href} href={n.href} className={n.test(path) ? 'active' : undefined}>
              {n.label}
            </a>
          ))}
        </nav>
        <span className="spacer" />
        <span className="hint">strategy engine · local</span>
      </header>
      {page}
    </div>
  );
}
