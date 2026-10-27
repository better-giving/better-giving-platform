/** the search param "Load more videos" raises */
export const VIDEOS_PAGE = "videos";
export const VIDEOS_STEP = 10;
export const MAX_SHOWN = 200;

/** the param as a row count: a step multiple, never past `MAX_SHOWN` */
export function videos_shown(param: string | undefined): number {
  const n = Math.ceil(Number(param) / VIDEOS_STEP) * VIDEOS_STEP;
  return Number.isFinite(n) && n > 0 ? Math.min(n, MAX_SHOWN) : VIDEOS_STEP;
}
