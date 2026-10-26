import { YouTubePlayer } from "#/components/youtube-player";

interface IVideo {
  classes?: string;
  url: string;
  title?: string;
}
export function Video(props: IVideo) {
  return (
    <div className="relative aspect-video rounded overflow-clip bg-gray-3">
      <YouTubePlayer url={props.url} title={props.title} />
    </div>
  );
}
