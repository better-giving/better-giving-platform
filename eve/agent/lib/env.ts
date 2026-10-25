/** Reads a secret from the server environment, failing loudly when it is missing. */
export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set.`);
  return value;
}
