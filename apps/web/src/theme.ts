import { useEffect, useState } from 'react';

/** Categorical slots from the dataviz palette, light and dark steps. Fixed order, never cycled. */
const LIGHT = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7', '#e34948'];
const DARK = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767'];

export function useDark(): boolean {
  const mq = typeof window !== 'undefined' ? window.matchMedia('(prefers-color-scheme: dark)') : null;
  const [dark, setDark] = useState(mq?.matches ?? false);
  useEffect(() => {
    if (!mq) return;
    const onChange = (e: MediaQueryListEvent) => setDark(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [mq]);
  return dark;
}

export function seriesColor(i: number, dark: boolean): string {
  const p = dark ? DARK : LIGHT;
  return p[i % p.length]!;
}

export interface ChartTheme {
  dark: boolean;
  surface: string;
  text: string;
  muted: string;
  grid: string;
  pos: string;
  neg: string;
  amber: string;
  /** end-reason colors: neutral tones plus status colors for goal/loss/bust */
  reasons: Record<string, string>;
}

export function useChartTheme(): ChartTheme {
  const dark = useDark();
  return dark
    ? {
        dark,
        surface: '#142420',
        text: '#efe8d8',
        muted: '#8f897b',
        grid: '#243b33',
        pos: '#5cc48f',
        neg: '#ee7b74',
        amber: '#e9b949',
        reasons: { maxShooters: '#5a6f66', maxRolls: '#7f948b', walkedAway: '#9085e9', winGoal: '#0ca30c', stopLoss: '#ec835a', busted: '#d03b3b', diceExhausted: '#555' },
      }
    : {
        dark,
        surface: '#fbf8f2',
        text: '#1b1a17',
        muted: '#7d7667',
        grid: '#e4dccb',
        pos: '#0a7a3c',
        neg: '#b4261f',
        amber: '#b07a00',
        reasons: { maxShooters: '#b9b1a0', maxRolls: '#8f887a', walkedAway: '#4a3aa7', winGoal: '#0ca30c', stopLoss: '#ec835a', busted: '#d03b3b', diceExhausted: '#555' },
      };
}
