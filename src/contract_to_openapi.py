"""Translate a supplied Markdown POST/JSON service contract into an input tool catalog.

This is an input adapter. It copies paths and request fields from the source; it
does not create or edit a generated phone workflow.
"""

import argparse
import hashlib
import json
import re
from pathlib import Path


def schema(value):
    if isinstance(value, bool):
        return {"type": "boolean"}
    if isinstance(value, int):
        return {"type": "integer"}
    if isinstance(value, float):
        return {"type": "number"}
    if isinstance(value, str):
        return {"type": "string"}
    if isinstance(value, list):
        return {"type": "array", "items": schema(value[0]) if value else {}}
    if isinstance(value, dict):
        return {
            "type": "object",
            "properties": {name: schema(item) for name, item in value.items()},
            "required": list(value),
        }
    raise ValueError("Request example contains null; its type is ambiguous")


def contract_file(folder):
    candidates = []
    for path in Path(folder).rglob("*.md"):
        text = path.read_text(encoding="utf-8")
        if "## 5. Services" in text and "### 5.1" in text and "Request:" in text:
            candidates.append((path, text))
    if len(candidates) != 1:
        raise ValueError(f"Expected one Markdown service contract, found {len(candidates)}")
    return candidates[0]


def compile_contract(folder, hints):
    path, text = contract_file(folder)
    base_match = re.search(r"https://[^\s`]+/voice/v\d+/", text)
    if not base_match:
        raise ValueError("Contract has no voice service base URL")
    base = base_match.group(0)
    headings = list(re.finditer(r"^###\s+5\.\d+\s+`([^`]+)`\s*$", text, re.M))
    if not headings:
        raise ValueError("Contract has no numbered service definitions")
    paths = {}
    for index, heading in enumerate(headings):
        end = headings[index + 1].start() if index + 1 < len(headings) else text.find("\n## 6.", heading.end())
        section = text[heading.end() : end if end >= 0 else len(text)]
        request_match = re.search(r"Request:\s*```json\s*(\{.*?\})\s*```", section, re.S)
        if not request_match:
            raise ValueError(f"Missing JSON request example for {heading.group(1)}")
        request = json.loads(request_match.group(1))
        if not isinstance(request.get("data"), dict) or not isinstance(request.get("call"), dict):
            raise ValueError(f"Invalid data/call envelope for {heading.group(1)}")
        request_schema = schema(request)
        for field, default in hints.get(heading.group(1), {}).items():
            if field not in request_schema["properties"]["data"]["properties"]:
                raise ValueError(f"Hint {field} is absent from {heading.group(1)}")
            request_schema["properties"]["data"]["properties"][field]["default"] = default
        for field, value in request["call"].items():
            request_schema["properties"]["call"]["properties"][field]["default"] = (
                "" if isinstance(value, str) and value.startswith("<") else value
            )
        name = heading.group(1)
        paths["/" + name] = {
            "post": {
                "operationId": name.replace(".", "_"),
                "summary": name,
                "description": section.strip(),
                "requestBody": {
                    "required": True,
                    "content": {"application/json": {"schema": request_schema}},
                },
                "responses": {"200": {"description": "See original contract and test fixture"}},
            }
        }
    return {
        "openapi": "3.0.3",
        "info": {"title": "Supplied bank service contract", "version": hashlib.sha256(text.encode()).hexdigest()[:12]},
        "servers": [{"url": base.rstrip("/")}],
        "paths": paths,
        "x-source-contract": str(path.resolve()),
        "x-source-sha256": hashlib.sha256(text.encode()).hexdigest(),
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("case_folder")
    parser.add_argument("--hints", required=True)
    parser.add_argument("--out", required=True)
    args = parser.parse_args()
    hints = json.loads(Path(args.hints).read_text(encoding="utf-8"))
    result = compile_contract(args.case_folder, hints)
    Path(args.out).write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
