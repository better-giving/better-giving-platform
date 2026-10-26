import { Video } from "#/routes/_app.campaigns.$fund_id/video";
import type { IVideoItem } from "./items";

export interface IVideoSet {
  videos: IVideoItem[];
  classes?: string;
}

/** one plays at full width, two as halves, three or four as one large over
 * the smaller ones. phones stack them all. nothing when there are none */
export function VideoSet({ videos, classes = "" }: IVideoSet) {
  const n = videos.length;
  if (n === 0) return null;
  // a frame's title is how assistive tech tells several apart
  const frames = videos.map((v, i) => (
    <Video key={v.id} url={v.url} title={v.title ?? `Video ${i + 1} of ${n}`} />
  ));
  if (n < 3) {
    return (
      <div
        data-count={n}
        className={`grid gap-4 ${n === 2 ? "md:grid-cols-2" : ""} ${classes}`}
      >
        {frames}
      </div>
    );
  }
  const [large, ...small] = frames;
  return (
    <div data-count={n} className={`grid gap-4 ${classes}`}>
      {large}
      <div
        className={`grid gap-4 ${small.length === 2 ? "md:grid-cols-2" : "md:grid-cols-3"}`}
      >
        {small}
      </div>
    </div>
  );
}
