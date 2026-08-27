// High quality scientific colormaps (Coolwarm, Turbo, Viridis, Jet)

export function interpolateColor(
  value: number,
  min: number,
  max: number,
  scheme: 'coolwarm' | 'viridis' | 'turbo' | 'jet' | 'rainbow' = 'coolwarm'
): string {
  const norm = Math.max(0, Math.min(1, max === min ? 0.5 : (value - min) / (max - min)));

  if (scheme === 'coolwarm') {
    // Blue (0.0) -> White (0.5) -> Red (1.0)
    let r = 0, g = 0, b = 0;
    if (norm < 0.5) {
      const t = norm * 2;
      r = Math.round(59 + (240 - 59) * t);
      g = Math.round(76 + (240 - 76) * t);
      b = Math.round(192 + (240 - 192) * t);
    } else {
      const t = (norm - 0.5) * 2;
      r = Math.round(240 + (180 - 240) * t);
      g = Math.round(240 + (4 - 240) * t);
      b = Math.round(240 + (38 - 240) * t);
    }
    return `rgb(${r}, ${g}, ${b})`;
  } else if (scheme === 'viridis') {
    // Purple -> Teal -> Yellow
    const r = Math.round(255 * (0.28 + 0.7 * Math.pow(norm, 2)));
    const g = Math.round(255 * (0.05 + 0.9 * norm));
    const b = Math.round(255 * (0.45 + 0.5 * (1 - norm)));
    return `rgb(${r}, ${g}, ${b})`;
  } else if (scheme === 'turbo') {
    // Turbo rainbow colormap approximation
    const r = Math.round(255 * Math.sin(norm * Math.PI * 0.9));
    const g = Math.round(255 * Math.sin(norm * Math.PI));
    const b = Math.round(255 * Math.cos(norm * Math.PI * 0.6));
    return `rgb(${Math.max(0, r)}, ${Math.max(0, g)}, ${Math.max(0, b)})`;
  } else {
    // Standard Jet / Rainbow
    const h = (1.0 - norm) * 240; // 240 (blue) to 0 (red)
    return `hsl(${h}, 100%, 50%)`;
  }
}
