import { Image } from "@better-giving/ui";
import flying_character from "#/assets/images/flying-character.webp";

interface Endow {
  name: string;
  logo?: string | null;
}

export default function Loader({ name, logo = flying_character }: Endow) {
  return (
    <div
      className={
        "flex flex-col gap-1 w-full py-6 px-5 border-b border-hairline"
      }
    >
      <div className="flex justify-between">
        <Image className="size-14" src={logo || flying_character} />
      </div>
      <h5 className="text-sm font-bold truncate mt-2">{name}</h5>
    </div>
  );
}
