import { parseArgs } from 'node:util';
import { FreyaClient, redactConfig } from './freya-client.ts';

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      workspace: { type: 'string' },
      language: { type: 'string' },
      help: { type: 'boolean' },
    },
  });
  if (values.help || !positionals.length) {
    console.log(
      'Read-only public Freya API probe.\nnode --env-file=.env src/freya-cli.ts workspaces\nnode --env-file=.env src/freya-cli.ts defaults --workspace UUID [--language en]',
    );
    return;
  }
  if (positionals.length !== 1 || !['workspaces', 'defaults'].includes(positionals[0])) {
    throw new Error('Use workspaces or defaults.');
  }
  const client = new FreyaClient(process.env.FREYA_API_KEY || '');
  const signal = AbortSignal.timeout(30000);
  const result =
    positionals[0] === 'workspaces'
      ? await client.listWorkspaces(signal)
      : await client.getDefaults(
          values.workspace || process.env.FREYA_WORKSPACE_ID || '',
          signal,
          values.language,
        );
  console.log(JSON.stringify(redactConfig(result), null, 2));
}
main().catch((error) => {
  const message = error instanceof Error ? error.message : 'Freya request failed';
  console.error(
    process.env.FREYA_API_KEY
      ? message.replaceAll(process.env.FREYA_API_KEY, '[REDACTED]')
      : message,
  );
  process.exitCode = 1;
});
