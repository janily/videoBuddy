/** Explicit allowlist used for every untrusted-render and media subprocess. */
export function sanitizedEnvironment(env:Record<string,string|undefined>=process.env):NodeJS.ProcessEnv{
 return{NODE_ENV:'production',PATH:env.PATH||'/usr/local/bin:/usr/bin:/bin',LANG:env.LANG||'C.UTF-8',LC_ALL:'C.UTF-8'};
}
