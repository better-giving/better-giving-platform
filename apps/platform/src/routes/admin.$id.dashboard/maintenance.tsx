import { useEffect, useState } from "react";
import laira_happy_jump from "#/assets/laira/laira-happy-jump.webp";

export default function Component() {
  const [time, setTime] = useState(120); // start with 120 minutes (2 hours)

  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      const startTime = new Date(now);
      startTime.setUTCHours(6, 30, 0, 0);
      const endTime = new Date(startTime.getTime() + 2 * 60 * 60 * 1000); // 2 hours later

      if (now >= startTime && now < endTime) {
        const remaining = Math.floor(
          (endTime.getTime() - now.getTime()) / 60000
        );
        setTime(remaining);
      } else if (now < startTime) {
        setTime(120); // if before 6:30 UTC, show full 2 hours
      } else {
        setTime(0); // if after 8:30 UTC, show 0
      }
    };

    updateTime(); // initial update
    const interval = setInterval(updateTime, 60000); // update every minute

    return () => clearInterval(interval);
  }, []);

  const formatTime = (time: number) => {
    const hours = Math.floor(time / 60);
    const minutes = time % 60;
    if (hours > 0) {
      return `${hours} hour${hours > 1 ? "s" : ""} ${minutes} minute${minutes !== 1 ? "s" : ""}`;
    }
    return `${minutes} minute${minutes !== 1 ? "s" : ""}`;
  };

  return (
    <div className="px-6 py-4 md:px-10 md:py-8 w-full max-w-[1400px] grid content-start">
      <h1 className="text-3xl font-bold mb-4">Dashboard</h1>
      <div className="flex items-center gap-2">
        <p className="mt-4 text-gray-11">
          Your new dashboard experience is underway
        </p>
        <img
          src={laira_happy_jump}
          className="h-10 object-contain"
          alt="Laira jumping"
        />
      </div>
      <p className="text-gray-11 mt-2">
        Please bear with us while we bring final pieces together
      </p>
      <p className="text-gray-11 text-sm mt-4">
        Changes are expected to be live in{" "}
        <span className="text-base font-bold">{formatTime(time)}</span>
      </p>
    </div>
  );
}
