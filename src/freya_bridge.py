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
import uuid

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
    if action == 'recover-practice':
        from practice_recovery import recover_practice
        runner = importlib.import_module('run_cases')
        result = recover_practice(request, freya, runner, log)
        pathlib.Path(request['path']).write_text(json.dumps(clean(result), indent=2) + '\n')
        return result
    if action == 'probe':
        items = freya.api('GET', '/api/v2/workspaces')['workspaces']
        desired = os.environ.get('FREYA_WORKSPACE_ID')
        matches = [item for item in items if item['id'] == desired] if desired else items
        if len(matches) != 1:
            raise RuntimeError('Set FREYA_WORKSPACE_ID to one accessible workspace; automatic selection requires exactly one workspace')
        return {'workspaceId': matches[0]['id'], 'name': matches[0].get('name'), 'agentLlm': freya.AGENT_LLM}
    if action == 'validate':
        # The dry-run endpoint rejects a name already used by a registered
        # workflow. Give validation its own disposable name so a slot can be
        # validated again before its existing workflow is updated.
        return freya.validate_workflow('validation-' + uuid.uuid4().hex[:16], request['workflow'])
    if action == 'register':
        # Preserve the organizer helper's slot/update semantics while giving a
        # newly created workflow a useful name independent of its state key.
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
        if creating:
            state[request['slot']] = freya.create_workflow(
                request.get('workflowName', request['slot']), request['workflow'])
        else:
            state[request['slot']]['version'] = freya.update_workflow(
                state[request['slot']]['workflow_id'], request['workflow'])
        state_path.write_text(json.dumps(state, indent=1))
        result = state[request['slot']]
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
        original_iteration = freya.get_iteration
        scored_iterations = {}

        def scored_iteration(sim_id, it_id):
            return scored_iterations.get((sim_id, it_id)) or original_iteration(sim_id, it_id)

        def completed_simulation(*args, **kwargs):
            result = original_simulation(*args, **kwargs)
            if result[2] != 'completed':
                raise RuntimeError('Practice simulation did not complete: ' + str(result[2]))
            # A completed summary can arrive before detailed judge verdicts.
            # Missing verdicts are missing evidence, not ten failed customers.
            iteration = original_iteration(result[0], result[1])
            rows = iteration.get('runs', [])
            variables = args[2] if len(args) > 2 else kwargs['variables_by_persona']
            if (len(rows) != len(variables) or {r.get('personaId') for r in rows} != set(variables)
                    or any(r.get('outcome') not in ('pass', 'fail') for r in rows)):
                raise RuntimeError('Completed simulation has incomplete judge verdicts; no score recorded')
            scored_iterations[(result[0], result[1])] = iteration
            return result

        freya.run_simulation = completed_simulation
        freya.get_iteration = scored_iteration
        cache = pathlib.Path(request['cacheDir'])
        cache.mkdir(parents=True, exist_ok=True)
        runner.ROOT = cache
        # Exact original case file; persistent persona cache is scoped to the verified workspace.
        sys.argv = ['run_cases.py', request['agentId'], '--cases', request['casesPath'], '--out', request['path'], '--reps', str(request.get('repetitions', 1))]
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
        dead = silent_run(data)
        if dead:
            # The phone agent never produced a reply after a customer turn in any case,
            # so nothing about the agent was measured. Drop the runner's own 0/N output
            # and record the infrastructure failure instead of a score the builder would
            # then be judged against.
            path.unlink(missing_ok=True)
            raise RuntimeError(dead)
        path.write_text(json.dumps(data, indent=2) + '\n')
        return data
    raise RuntimeError('Unknown bridge action')


def silent_run(data):
    """Describe a run in which the agent never answered, or None when it spoke.

    `slowest_turn_s` is the longest gap between a customer message and the agent's next
    one, so it stays 0 only when no agent message ever followed a customer turn. A run
    where every case looks like that is a dead platform model, not a weak agent.
    """
    rows = data.get('rows') if isinstance(data, dict) else None
    measured = [r for r in rows if isinstance(r, dict) and 'slowest_turn_s' in r] if isinstance(rows, list) else []
    if len(measured) < 2:
        return None
    if all(r.get('slowest_turn_s') == 0 for r in measured) and all(
        r.get('ended') == 'customer-ended-call' for r in measured
    ):
        return (
            'No case received a reply after the customer spoke, so the run measured the '
            'platform model rather than the agent. The agent model did not answer; this is '
            'not a score. Repeat the test once the agent model responds.'
        )
    return None


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
