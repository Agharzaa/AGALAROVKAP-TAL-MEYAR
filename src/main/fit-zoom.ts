/**
 * How much the page grows with the window, from its content width in device-independent
 * pixels (Windows display scaling is already in them). The design is drawn for widths up to
 * about 1760 px; a wider window enlarges everything in 0.05 steps up to 1.25 — a full HD
 * monitor gets 1.05, so the text is a touch larger and the extra width still shows more rows
 * and columns. A narrow window (under 1200 px) is fitted slightly smaller so the main menu and
 * forms still fit.
 */
export function fitZoom(width: number): number {
  const min = width < 1200 ? 0.9 : 1;
  return Math.min(1.25, Math.max(min, Math.floor((width / 1760) * 20) / 20));
}
