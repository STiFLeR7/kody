import { expect, test } from 'vitest'
import {
	readCredentialListFilters,
	writeCredentialListQuery,
} from './credentials-list.ts'

test('writing filters replaces every filter key and keeps other params', () => {
	const params = new URLSearchParams('kind=secret&locked=true&tab=all')
	writeCredentialListQuery(params, {
		q: 'git',
		kinds: ['oauth', 'mcp'],
		scope: 'personal',
		locked: 'pkg-triage',
	})
	expect(params.toString()).toBe(
		'tab=all&q=git&kind=oauth&kind=mcp&scope=personal&locked=pkg-triage',
	)
	expect(readCredentialListFilters(params)).toEqual({
		q: 'git',
		kinds: ['oauth', 'mcp'],
		scope: 'personal',
		locked: 'pkg-triage',
	})
	writeCredentialListQuery(params, { packageScoped: false, locked: true })
	expect(readCredentialListFilters(params)).toEqual({
		packageScoped: false,
		locked: true,
	})
})
