import { readFile } from 'node:fs/promises';
import { Ajv } from 'ajv';
import { expect, test } from 'bun:test';
import { SCHEMA_VERSION } from '../../src/report/model.js';

const load = async (rel: string) => JSON.parse(await readFile(new URL(rel, import.meta.url), 'utf8'));

test('the published reference fixture conforms to the JSON Schema', async () => {
  const validate = new Ajv({ allErrors: true, strict: false }).compile(await load('../../schema/jlgstat.schema.json'));
  const example = await load('../../schema/example.json');
  expect(validate(example), JSON.stringify(validate.errors, null, 2)).toBe(true);
  expect(example.schemaVersion).toBe(SCHEMA_VERSION);
});
