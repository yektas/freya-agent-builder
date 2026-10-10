"""Run the unchanged event client/scorer behind a bounded JSON subprocess boundary."""
import contextlib
import importlib
import json
import os
import pathlib
import re
import sys
import time
import urllib.request

request = json.load(sys.stdin)
kit = pathlib.Path(request['kit']).resolve()
sys.path[:0] = [str(kit), str(kit / 'tools')]
freya = importlib.import_module('freya')
deadline = time.monotonic() + request['timeoutMs'] / 1000
secrets = [os.environ.get(key, '') for key in ('FREYA_API_KEY', 'FREYA_BANK_TEAM_KEY', 'OPENAI_API_KEY')]
# A platform error body can echo the request headers back as free text, where the
# key-based filter above never sees it.
AUTH = re.compile(r'(?i)\b(bearer\s+|basic\s+)(?!\[REDACTED\])\S+')


def clean(value):
    if isinstance(value, dict):
        return {key: clean(item) for key, item in value.items()
                if key.lower() not in ('authorization', 'x-team-key', 'apikey', 'api_key')}
    if isinstance(value, list):
        return [clean(item) for item in value]
    if isinstance(value, str):
        for secret in secrets:
            if secret:
                value = value.replace(secret, '[REDACTED]')
        value = AUTH.sub(r'\1[REDACTED]', value)
        # System transcript messages encode the full request, including headers, as JSON text.
        if value.lstrip().startswith(('{', '[')):
            try:
                return json.dumps(clean(json.loads(value)))
            except (ValueError, RecursionError):
                pass
        return value
    return value


def log(value):
    with open(request['trace'], 'a') as out:
        out.write(json.dumps(clean({'at': time.strftime('%Y-%m-%dT%H:%M:%S%z'), **value})) + '\n')


original_urlopen = urllib.request.urlopen


def bounded_urlopen(*args, **kwargs):
    left = deadline - time.monotonic()
    if left <= 0:
        raise TimeoutError('Freya operation deadline exceeded')
    kwargs['timeout'] = min(kwargs.get('timeout', 120), left)
    return original_urlopen(*args, **kwargs)


urllib.request.urlopen = bounded_urlopen
original_api = freya.api


def traced_api(method, path, body=None, **params):
    log({'kind': 'freya-request', 'method': method, 'path': path, 'body': body, 'params': params})
    result = original_api(method, path, body, **params)
    if isinstance(result, dict) and result.get('success') is False:
        raise RuntimeError('Freya rejected the request')
    log({'kind': 'freya-response', 'method': method, 'path': path, 'result': result})
    return result


freya.api = traced_api


def main():
    action = request['action']
    if action == 'probe':
        items = freya.api('GET', '/api/v2/workspaces')['workspaces']
        desired = os.environ.get('FREYA_WORKSPACE_ID')
        matches = [item for item in items if item['id'] == desired] if desired else items
        if len(matches) != 1:
            raise RuntimeError('Set FREYA_WORKSPACE_ID to one accessible workspace; automatic selection requires exactly one workspace')
        return {'workspaceId': matches[0]['id'], 'name': matches[0].get('name'), 'agentLlm': freya.AGENT_LLM}
    if action == 'validate':
        return freya.validate_workflow(request['slot'], request['workflow'])
    if action == 'register':
        # The organizer helper reuses the slot and publishes updates. No automatic retry on create.
        state_path = pathlib.Path(request['stateFile'])
        state = json.loads(state_path.read_text()) if state_path.exists() else {}
        pending = state_path.with_name(state_path.name + '.' + request['slot'] + '.pending')
        if pending.exists():
            raise RuntimeError('Previous registration has an uncertain result; inspect the trace and reconcile the slot before trying again: ' + str(pending))
        creating = request['slot'] not in state
        if creating:
            # A timeout can happen after Freya stored the workflow but before its id arrived.
            # Keep this marker on failure so a later run cannot silently create a duplicate.
            with pending.open('x') as out:
                json.dump({'slot': request['slot'], 'trace': request['trace']}, out)
        result = freya.save_workflow(request['slot'], request['workflow'], request['stateFile'])
        if creating:
            pending.unlink()
        return result
    if action == 'export':
        freya.export_workflow(request['workflowId'], request['path'])
        # Persisted export must retain its definition while excluding auth material.
        path = pathlib.Path(request['path'])
        data = clean(json.loads(path.read_text()))
        path.write_text(json.dumps(data, indent=2) + '\n')
        return {'path': str(path), 'workflowId': data['workflow_id'], 'agentId': data['agent_id']}
    if action == 'practice':
        runner = importlib.import_module('run_cases')
        original_simulation = freya.run_simulation

        def completed_simulation(*args, **kwargs):
            result = original_simulation(*args, **kwargs)
            if result[2] != 'completed':
                raise RuntimeError('Practice simulation did not complete: ' + str(result[2]))
            return result

        freya.run_simulation = completed_simulation
        cache = pathlib.Path(request['cacheDir'])
        cache.mkdir(parents=True, exist_ok=True)
        runner.ROOT = cache
        # Exact original case file; persistent persona cache is scoped to the verified workspace.
        sys.argv = ['run_cases.py', request['agentId'], '--cases', request['casesPath'], '--out', request['path'], '--reps', '1']
        for flag, key in [('--brief', 'brief'), ('--only', 'only'), ('--style', 'style')]:
            if request.get(key):
                sys.argv.extend([flag, request[key]])
        # Bank requests omit x-team-key from the trace.
        original_http = runner.http

        def traced_http(path, body=None):
            log({'kind': 'bank-request', 'path': path, 'body': body})
            result = original_http(path, body)
            if isinstance(result, dict) and result.get('error'):
                raise RuntimeError('Bank practice API rejected the request: ' + str(result['error']))
            log({'kind': 'bank-response', 'path': path, 'result': result})
            return result

        runner.http = traced_http
        runner.main()
        path = pathlib.Path(request['path'])
        data = clean(json.loads(path.read_text()))
        path.write_text(json.dumps(data, indent=2) + '\n')
        return data
    raise RuntimeError('Unknown bridge action')


class SafeProgress:
    def write(self, value):
        sys.stderr.write(clean(value))
    def flush(self):
        sys.stderr.flush()


try:
    with contextlib.redirect_stdout(SafeProgress()):
        result = main()
    print(json.dumps({'ok': True, 'result': clean(result)}))
except Exception as error:
    message = clean(str(error))
    log({'kind': 'error', 'action': request['action'], 'error': message})
    print(json.dumps({'ok': False, 'error': message}))
    sys.exit(1)
