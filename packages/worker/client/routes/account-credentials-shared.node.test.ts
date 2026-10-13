import { expect, test } from 'vitest'
import { type AccountCredentialListItem } from '#universal/credentials-list.ts'
import {
	filterCredentialList,
	readCredentialListFilters,
	writeCredentialListFilters,
} from './account-credentials-shared.ts'

function credential(
	overrides: Partial<AccountCredentialListItem> & { id: string; name: string },
): AccountCredentialListItem {
	return {
		kind: 'secret',
		description: '',
		provider: null,
		hosts: [],
		owner: 'org',
		packageId: null,
		lockedPackageIds: [],
		status: 'ready',
		expiresAt: null,
		updatedAt: '2026-10-11T00:00:00.000Z',
		manageHref: `/@acme/-/secrets/${overrides.name}`,
		...overrides,
	}
}

const credentials = [
	credential({ id: 'a', name: 'OPENAI_API_KEY', hosts: ['api.openai.com'] }),
	credential({ id: 'b', name: 'github', kind: 'oauth', owner: 'personal' }),
	credential({ id: 'c', name: 'SLACK_TOKEN', packageId: 'pkg-digest' }),
	credential({
		id: 'd',
		name: 'docs',
		kind: 'mcp',
		lockedPackageIds: ['pkg-triage'],
	}),
]
const packagesById = new Map([
	['pkg-digest', { kodyId: 'daily-digest', name: 'Daily digest' }],
	['pkg-triage', { kodyId: 'github-triage', name: 'GitHub triage' }],
])

function ids(href: string) {
	return filterCredentialList(
		credentials,
		readCredentialListFilters(href),
		packagesById,
	).map((item) => item.id)
}

test('URL filters narrow the list by kind, owner, package scope, and search', () => {
	expect(ids('/@acme/-/credentials')).toEqual(['a', 'b', 'c', 'd'])
	expect(ids('/@acme/-/credentials?kind=oauth')).toEqual(['b'])
	expect(ids('/@acme/-/credentials?owner=personal')).toEqual(['b'])
	expect(ids('/@acme/-/credentials?packages=package')).toEqual(['c'])
	expect(ids('/@acme/-/credentials?packages=locked')).toEqual(['d'])
	expect(ids('/@acme/-/credentials?package=pkg-triage')).toEqual(['d'])
	expect(ids('/@acme/-/credentials?q=openai.com')).toEqual(['a'])
	// Search matches the package a credential belongs or is locked to.
	expect(ids('/@acme/-/credentials?q=daily-digest')).toEqual(['c'])
	expect(ids('/@acme/-/credentials?q=MCP')).toEqual(['d'])
	// Unknown values fall back to showing everything.
	expect(ids('/@acme/-/credentials?kind=bogus&owner=nobody')).toEqual([
		'a',
		'b',
		'c',
		'd',
	])
})

test('writing filters keeps the path and drops defaults', () => {
	expect(
		writeCredentialListFilters('/@acme/-/credentials?kind=oauth&x=1', {
			search: 'git',
			kind: 'all',
			owner: 'personal',
			packageFilter: 'all',
			packageId: '',
		}),
	).toBe('/@acme/-/credentials?x=1&q=git&owner=personal')
})
