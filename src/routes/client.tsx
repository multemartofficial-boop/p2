import { Outlet, createFileRoute } from "@tanstack/react-router";
import { RequireRole } from "@/components/hr/auth-guard";

export const Route = createFileRoute("/client")({
  head: () => ({
    meta: [
      { title: "Contractor — WorkHR" },
      { name: "description", content: "Contractor portal" },
    ],
  }),
  component: ClientRoute,
});

function ClientRoute() {
  return (
    <RequireRole role="client">
      <Outlet />
    </RequireRole>
  );
}
