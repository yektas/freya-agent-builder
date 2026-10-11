// Scalar extraction transport. Authored types are validated after unconstrained staging.
import type { JsonObject } from './contracts.ts';

const types = ['string', 'integer', 'float', 'boolean', 'date', 'datetime', 'name', 'phone_number'];
// The platform runs ONE extraction call per turn for a node's whole schema, and a custom
// extraction_prompt REPLACES its built-in template rather than extending it. Recorded runs
// that reached a node carrying many long injected prompts produced no extraction, routing
// or dialogue event at all, and the call hung until the customer hung up: 71 staged fields
// and 67 KB of schema. One collection node stays a single small question; the recorded
// 14-field negotiation node is the shape to split rather than widen.
export const maxObservationFields = 12;
export const maxObservationBytes = 5000;
const keys = [
  'name',
  'type',
  'description',
  'enum_values',
  'validation_pattern',
  'min_confidence',
  'max_retries',
  'extraction_prompt',
];

export function stagedObservations(fields: JsonObject[], index: number) {
  for (const field of fields) {
    if (
      !types.includes(String(field.type)) ||
      Object.keys(field).some((key) => !keys.includes(key))
    ) {
      throw new Error(
        'Unsupported extraction type or constraint; cannot establish observation validity.',
      );
    }
    if (field.description !== undefined && typeof field.description !== 'string') {
      throw new Error('Extraction description must be text.');
    }
    if (
      /\bjson\b|serialized|serialised/i.test(
        String(field.description ?? '') + String(field.extraction_prompt ?? ''),
      )
    ) {
      throw new Error('Extract independent scalar fields, not serialized JSON observations.');
    }
    if (
      field.enum_values !== undefined &&
      (!Array.isArray(field.enum_values) ||
        !field.enum_values.length ||
        field.enum_values.some((v) => typeof v !== 'string' || v === '__builder_missing__'))
    ) {
      throw new Error(
        'Extraction enum_values must be nonempty strings excluding the missing marker.',
      );
    }
    if (field.validation_pattern !== undefined && typeof field.validation_pattern !== 'string') {
      throw new Error('Extraction validation_pattern must be text.');
    }
    if (
      field.max_retries !== undefined &&
      (!Number.isInteger(field.max_retries) ||
        Number(field.max_retries) < 0 ||
        Number(field.max_retries) > 3)
    ) {
      throw new Error('Extraction max_retries must be an integer from 0 to 3.');
    }
  }
  if (fields.length > maxObservationFields) {
    throw new Error(
      `Extraction declares ${fields.length} fields; one node supports at most ${maxObservationFields}. Split the stage into separate collection nodes.`,
    );
  }
  // The consume hook embeds these, so keep prompt text out of the code payload.
  const specs: JsonObject[] = fields.map((field, i) => ({
    name: field.name,
    type: field.type,
    staging: `builder_input_${index}_${i}`,
    ...(field.enum_values === undefined ? {} : { enum_values: field.enum_values }),
    ...(field.validation_pattern === undefined
      ? {}
      : { validation_pattern: field.validation_pattern }),
  }));
  const schema: JsonObject[] = fields.map((field, i) => ({
    name: `builder_input_${index}_${i}`,
    type: 'string',
    min_confidence: field.min_confidence,
    max_retries: 0,
    description: `${field.description ?? field.name}. Return one scalar as text, type ${field.type}.${field.enum_values ? ` Allowed values: ${JSON.stringify(field.enum_values)}.` : ''}${field.validation_pattern ? ` Required pattern: ${field.validation_pattern}.` : ''} No labels, JSON objects or arrays. Omit any value the customer did not supply in this turn.`,
    // The platform runs ONE extraction call per turn for the whole node schema, and a
    // custom extraction_prompt REPLACES the built-in template rather than extending it.
    // Injecting boilerplate onto every staged field turned each authored field into a
    // prompt the platform never returned from: recorded calls reached the node and then
    // produced no extraction, routing or dialogue event at all. Let the built-in template
    // run unless the author supplied a placeholder-complete prompt for a real reason.
    ...(field.extraction_prompt === undefined
      ? {}
      : { extraction_prompt: field.extraction_prompt }),
  }));
  const bytes = JSON.stringify(schema).length;
  if (bytes > maxObservationBytes) {
    throw new Error(
      `Extraction schema is ${bytes} bytes; one node supports at most ${maxObservationBytes}. Drop custom extraction prompts and shorten descriptions.`,
    );
  }
  const reset = specs
    .flatMap((field) => [field.name, field.staging])
    .map((name) => `vars[${JSON.stringify(name)}] = '__builder_missing__'`)
    .join('\n');
  // The schema names belong only to staging. Public observation aliases therefore accept
  // the missing marker even when their original authored type/pattern would reject it.
  const consume = `import json, re, datetime
_builder_specs = json.loads(${JSON.stringify(JSON.stringify(specs))})
for _builder_field in _builder_specs:
    _builder_name = _builder_field['name']
    vars[_builder_name] = '__builder_missing__'
    try:
        _builder_value = vars.get(_builder_field['staging'], '__builder_missing__')
        if not isinstance(_builder_value, str):
            raise ValueError('non-string observation')
        _builder_value = _builder_value.strip()
        if not _builder_value or _builder_value == '__builder_missing__':
            continue
        _builder_type = _builder_field['type']
        if _builder_type == 'integer':
            if not re.fullmatch(r'[+-]?[0-9]+', _builder_value): raise ValueError('integer')
        elif _builder_type == 'float':
            if not re.fullmatch(r'[+-]?(?:[0-9]+(?:\\.[0-9]*)?|\\.[0-9]+)(?:[eE][+-]?[0-9]+)?', _builder_value): raise ValueError('float')
            if abs(float(_builder_value)) == float('inf'): raise ValueError('nonfinite')
        elif _builder_type == 'boolean':
            if _builder_value not in ['true', 'false']: raise ValueError('boolean')
        elif _builder_type == 'date':
            if not re.fullmatch(r'[0-9]{4}-[0-9]{2}-[0-9]{2}', _builder_value): raise ValueError('date')
            datetime.date.fromisoformat(_builder_value)
        elif _builder_type == 'datetime':
            if not re.fullmatch(r'[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\\.[0-9]+)?(?:Z|[+-][0-9]{2}:[0-9]{2})?', _builder_value): raise ValueError('datetime')
            datetime.datetime.fromisoformat(_builder_value.replace('Z', '+00:00'))
        elif _builder_type == 'phone_number':
            if not re.fullmatch(r'\\+?[0-9][0-9 ()-]*', _builder_value): raise ValueError('phone number')
        if 'enum_values' in _builder_field and _builder_value not in _builder_field['enum_values']: raise ValueError('enum')
        if 'validation_pattern' in _builder_field and not re.search(_builder_field['validation_pattern'], _builder_value): raise ValueError('pattern')
        vars[_builder_name] = _builder_value
    except Exception:
        pass
`;
  return { schema, reset, consume, count: fields.length };
}
