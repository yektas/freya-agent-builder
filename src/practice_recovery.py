"""Recover a finished practice simulation with the original scorer and GET requests only."""
import datetime
import json
import pathlib


def recover_practice(request, freya, runner, log):
    # Recover only the simulation(s) created inside this job's recorded window.
    start = datetime.datetime.fromisoformat(request['startedAt'].replace('Z', '+00:00'))
    end = datetime.datetime.fromisoformat(request['endedAt'].replace('Z', '+00:00'))
    cases = [c for c in json.loads(pathlib.Path(request['casesPath']).read_text())
             if (request.get('brief') in (None, 'all') or c['brief'] == request['brief'])
             and (not request.get('only') or c['id'] in request['only'].split(','))]
    if not cases:
        raise RuntimeError('Recovery has no matching cases')
    expected = {c['id'] for c in cases}
    sessions, simulations = {}, []
    pending_case, pending_simulation = None, None
    for line in pathlib.Path(request['trace']).read_text().splitlines():
        entry = json.loads(line)
        at = datetime.datetime.fromisoformat(entry['at'].replace('Z', '+00:00'))
        # Bridge timestamps have second precision; include the start's first second.
        if not (start.replace(microsecond=0) <= at <= end):
            continue
        kind, path = entry.get('kind'), entry.get('path')
        if kind == 'bank-request' and path == '/v1/practice/sessions':
            pending_case = entry['body']['case']
        elif kind == 'bank-response' and path == '/v1/practice/sessions':
            if pending_case is None:
                raise RuntimeError('Recovery is missing a session request')
            sessions[pending_case] = entry['result']['variables']
            pending_case = None
        elif kind == 'freya-request' and entry.get('method') == 'POST' and path == '/api/v2/simulations':
            pending_simulation = entry['body']
        elif kind == 'freya-response' and entry.get('method') == 'POST' and path == '/api/v2/simulations':
            body = pending_simulation
            remote = entry['result'].get('simulation', entry['result'])
            if not body or body.get('agentId') != request['agentId']:
                raise RuntimeError('Recovery simulation does not match the recorded agent')
            variables = body['customerVariablesMap']
            by_customer = {v['customer_id']: k for k, v in variables.items()}
            ids = {c: by_customer.get(v['customer_id']) for c, v in sessions.items()}
            if (set(sessions) != expected or len(variables) != len(cases)
                    or any(not v for v in ids.values()) or len(set(ids.values())) != len(cases)):
                raise RuntimeError('Recovery session and persona mapping is incomplete')
            if remote.get('workspaceId', request['workspaceId']) != request['workspaceId']:
                raise RuntimeError('Recovery simulation belongs to a different workspace')
            simulations.append((remote['id'], dict(sessions), ids))
            sessions = {}
            pending_simulation = None
    if len(simulations) != request['repetitions']:
        raise RuntimeError('Recovery needs one recorded simulation per requested repetition')

    # The unchanged runner performs its real ledger/judge scoring and latency reads.
    # Replace only creation/waiting with already recorded identities. No new run.
    original_api = freya.api
    original_http = runner.http
    original_simulation = freya.run_simulation
    original_iteration = freya.get_iteration

    def read_api(method, *args, **kwargs):
        if method != 'GET':
            raise RuntimeError('Practice recovery permits GET requests only')
        return original_api(method, *args, **kwargs)

    freya.api = read_api
    repetitions = []
    recovered = []
    try:
        # Confirm every simulation has stopped before reading any bank records.
        for sim_id, sessions, ids in simulations:
            remote = freya.api('GET', f'/api/v2/simulations/{sim_id}')
            remote = remote.get('simulation', remote)
            if (remote.get('status') != 'completed'
                    or remote.get('agentId', request['agentId']) != request['agentId']
                    or remote.get('workspaceId', request['workspaceId']) != request['workspaceId']):
                raise RuntimeError('Recorded simulation is not completed for this agent and workspace')
            its = freya.api('GET', f'/api/v2/simulations/{sim_id}/iterations')
            its = its.get('iterations') or its.get('items') or its
            if len(its) != 1 or its[0].get('status', 'completed') != 'completed':
                raise RuntimeError('Recovery requires exactly one completed original iteration')
            it_id = its[0]['id']
            iteration = freya.get_iteration(sim_id, it_id)
            runs = iteration.get('runs', [])
            if (len(runs) != len(cases) or {r.get('personaId') for r in runs} != set(ids.values())
                    or any(r.get('outcome') not in ('pass', 'fail') for r in runs)):
                raise RuntimeError('Completed simulation has incomplete judge verdicts; recovery cannot record a score')
            recovered.append((sim_id, it_id, sessions, ids, iteration))
        for sim_id, it_id, sessions, ids, iteration in recovered:
            def existing_session(path, body=None):
                if body is not None:
                    if path != '/v1/practice/sessions' or body.get('case') not in sessions:
                        raise RuntimeError('Recovery refuses new bank sessions')
                    return {'variables': sessions[body['case']]}
                result = original_http(path)
                if isinstance(result, dict) and result.get('error'):
                    raise RuntimeError('Bank ledger could not be recovered: ' + str(result['error']))
                log({'kind': 'bank-response', 'path': path, 'result': result})
                return result

            def existing_simulation(agent_id, name, variables):
                if agent_id != request['agentId'] or variables != {ids[c]: sessions[c] for c in ids}:
                    raise RuntimeError('Recovery runner inputs changed')
                return sim_id, it_id, 'completed'

            runner.http = existing_session
            freya.run_simulation = existing_simulation
            # Score the same validated snapshot, not a later inconsistent response.
            freya.get_iteration = lambda *_: iteration
            # All calls are GETs; the runner combines the original ledger and judge.
            rows, _, _, _, _, _ = runner.run_once(request['agentId'], cases, ids)
            repetitions.append(rows)
    finally:
        freya.api = original_api
        runner.http = original_http
        freya.run_simulation = original_simulation
        freya.get_iteration = original_iteration
    final = [{'id': c['id'], 'family': c['family'],
              'passes': sum(rows[i]['pass'] for rows in repetitions),
              'runs': len(repetitions), 'pass': all(rows[i]['pass'] for rows in repetitions)}
             for i, c in enumerate(cases)]
    return {'agent_id': request['agentId'], 'simulation_id': recovered[-1][0],
            'iteration_id': recovered[-1][1], 'passed': sum(c['pass'] for c in final),
            'total': len(final), 'runs': len(repetitions), 'final': final,
            'rows': repetitions[-1], 'all_rows': repetitions,
            'recovered': True, 'simulations': [s[0] for s in recovered]}
