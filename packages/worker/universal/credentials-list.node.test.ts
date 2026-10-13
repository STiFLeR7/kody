import { expect, test } from 'vitest'
import { type CredentialListItem } from './credential-contracts.ts'
import {
	filterCredentialListItems,
	parseCredentialListQuery,
	writeCredentialListQuery,
} from './credentials-list.ts'

function credential(
	overrides: Partial<CredentialListItem> & { id: string; name: string },
): CredentialListItem {
	return {
		kind: 'secret',
		scope: 'org',
		provider: null,
		description: '',
		hosts: [],
		inject: null,
		packageId: null,
		lockedToPackageIds: [],
		expiresAt: null,
		createdAt: '2026-10-11T00:00:00.000Z',
		updatedAt: '2026-10-11T00:00:00.000Z',
		status: 'ok',
		statusMessage: null,
		mcp: null,
		...overrides,
	}
}

const credentials = [
	credential({ id: 'a', name: 'OPENAI_API_KEY', hosts: ['api.openai.com'] }),
	credential({
		id: 'b',
		name: 'work',
		kind: 'oauth',
		scope: 'personal',
		provider: 'github',
	}),
	credential({ id: 'c', name: 'SLACK_TOKEN', packageId: 'pkg-digest' }),
	credential({
		id: 'd',
		name: 'docs',
		kind: 'mcp',
		lockedToPackageIds: ['pkg-triage'],
	}),
]

function ids(query: string) {
	return filterCredentialListItems(
		credentials,
		parseCredentialListQuery(new URLSearchParams(query)),
	).map((item) => item.id)
}

test('list filters match the credentials list API contract', () => {
	expect(ids('')).toEqual(['a', 'b', 'c', 'd'])
	expect(ids('kind=oauth')).toEqual(['b'])
	expect(ids('kind=oauth&kind=mcp')).toEqual(['b', 'd'])
	expect(ids('scope=personal')).toEqual(['b'])
	expect(ids('packageScoped=true')).toEqual(['c'])
	expect(ids('packageScoped=false')).toEqual(['a', 'b', 'd'])
	expect(ids('locked=true')).toEqual(['d'])
	// A package id keeps what is locked to it and its own package-scoped Keys.
	expect(ids('locked=pkg-triage')).toEqual(['d'])
	expect(ids('locked=pkg-digest')).toEqual(['c'])
	// `q` is a case-insensitive substring of name, provider, description, or host.
	expect(ids('q=OPENAI.com')).toEqual(['a'])
	expect(ids('q=GitHub')).toEqual(['b'])
	// Unknown values are ignored rather than emptying the list.
	expect(ids('kind=vault&scope=nobody&packageScoped=maybe')).toEqual([
		'a',
		'b',
		'c',
		'd',
	])
})

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
	expect(parseCredentialListQuery(params)).toEqual({
		q: 'git',
		kinds: ['oauth', 'mcp'],
		scope: 'personal',
		locked: 'pkg-triage',
	})
})
