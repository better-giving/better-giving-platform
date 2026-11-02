import { Outlet } from "react-router";

export default function Layout() {
  return (
    <div className="grid content-start relative px-4 py-4 md:px-10 md:py-8">
      <h1 className="sr-only">My donations</h1>
      <Outlet />
    </div>
  );
}
