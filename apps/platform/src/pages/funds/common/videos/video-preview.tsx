import { Minus, Pencil } from "lucide-react";
import { type ButtonHTMLAttributes, useState } from "react";
import { YouTubePlayer } from "#/components/youtube-player";
import type { Video } from "./types";
import { VideoModal } from "./video-modal";

interface IVideoPreview extends Video {
  idx: number;
  onEdit: (url: string, idx: number) => void;
  onDelete: (idx: number) => void;
}

export function VideoPreview(props: IVideoPreview) {
  const [open, set_open] = useState(false);
  return (
    <div>
      <VideoModal
        open={open}
        set_open={set_open}
        onSubmit={(url) => props.onEdit(url, props.idx)}
        initUrl={props.url}
      />
      <div className="flex justify-end mb-1">
        <CRUDBtn onClick={() => set_open(true)}>
          <Pencil className="icon-xs" />
        </CRUDBtn>
        <CRUDBtn onClick={() => props.onDelete(props.idx)}>
          <Minus className="text-destructive" />
        </CRUDBtn>
      </div>
      {/** render only thumbnails on lists */}
      <div className="relative aspect-video rounded overflow-clip">
        <YouTubePlayer url={props.url} thumbnail />
      </div>
    </div>
  );
}

function CRUDBtn({
  className,
  children,
  ...props
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, "type">) {
  return (
    <button
      {...props}
      type="button"
      className={`text-lg size-8 flex-center rounded-full hover:bg-secondary-hover group disabled:text-gray-11 ${className}`}
    >
      {children}
    </button>
  );
}
