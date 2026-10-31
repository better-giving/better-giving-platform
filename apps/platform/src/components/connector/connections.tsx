import { Button } from "@better-giving/ui";
import { useFetcher } from "react-router";

export interface IConnectionRow {
  id: string;
  prefix: string;
  last4: string;
  allowed_by_name: string;
  created_at: string;
  last_used_at: string | null;
}

export interface IConnections {
  connections: IConnectionRow[];
}

function format_time(iso: string) {
  return new Date(iso).toLocaleString();
}

function mask(row: IConnectionRow) {
  return `${row.prefix}…${row.last4}`;
}

function ConnectionRow(row: IConnectionRow) {
  const fetcher = useFetcher({ key: `revoke-${row.id}` });
  const label = mask(row);

  return (
    <li className="grid gap-4 py-4 first:pt-0 last:pb-0 md:grid-cols-[minmax(0,1fr)_auto] md:items-start">
      <div className="grid min-w-0 gap-3">
        <p className="font-medium">{label}</p>
        <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-2 text-sm">
          <dt className="text-gray-11">Allowed by</dt>
          <dd className="min-w-0">{row.allowed_by_name}</dd>
          <dt className="text-gray-11">Created</dt>
          <dd>
            <time dateTime={row.created_at}>{format_time(row.created_at)}</time>
          </dd>
          <dt className="text-gray-11">Last used</dt>
          <dd>
            {row.last_used_at ? (
              <time dateTime={row.last_used_at}>
                {format_time(row.last_used_at)}
              </time>
            ) : (
              "Never"
            )}
          </dd>
        </dl>
      </div>
      <Button
        type="button"
        variant="destructive"
        aria-label={`Revoke ${label}`}
        disabled={fetcher.state !== "idle"}
        onClick={() => {
          fetcher.submit(
            { revoke_key: row.id },
            { action: ".", method: "POST", encType: "application/json" }
          );
        }}
      >
        Revoke
      </Button>
    </li>
  );
}

export function Connections({ connections }: IConnections) {
  return (
    <section className="card grid gap-6">
      <h2 className="text-xl font-semibold">Claude & ChatGPT connections</h2>
      {connections.length === 0 ? (
        <p className="text-sm text-gray-11">No connections yet.</p>
      ) : (
        <ul className="divide-y divide-hairline">
          {connections.map((row) => (
            <ConnectionRow key={row.id} {...row} />
          ))}
        </ul>
      )}
    </section>
  );
}
