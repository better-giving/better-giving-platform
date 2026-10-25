import git from "eve/extensions/git";

// No Connect connector: git and gh in the sandbox authenticate through the
// firewall rules in sandbox.ts, so the token never enters the sandbox.
export default git({});
