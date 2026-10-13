import { DatabaseSync } from 'node:sqlite'
import {
	ownerIdFromStored,
	personIdFromStored,
	type OwnerId,
} from '@kody-internal/shared/owner-person-ids.ts'
import { type OrgRole } from '@kody-internal/shared/request-context.ts'
import { expect, test, vi } from 'vitest'
import { loadPackageMappingScopeForViewer } from '#app/package-credentials-access.ts'
import { saveSecret } from '#mcp/secrets/service.ts'
import { upsertGrant } from '#worker/orgs/access-writes.ts'
import { createOrganization } from '#worker/orgs/create-organization.ts'
import { provisionPersonalOrg } from '#worker/orgs/provision.ts'
import {
	getSavedPackageById,
	insertSavedPackage,
} from '#worker/package-registry/repo.ts'
import { deriveRequestContext } from '#worker/request-context/request-context.ts'
import { applyAllMigrations } from '#worker/test-support/apply-all-migrations.ts'
import {
	createAuditTestDb,
	createTestOrgAuditWriter,
} from '#worker/test-support/create-audit-db.ts'
import { createD1FromSqlite } from '#worker/test-support/create-d1-from-sqlite.ts'
import { testStableUserIdFromEmail } from '#worker/test-support/stable-user-id.ts'
import { createInMemoryUserMeterEnv } from '#worker/test-support/user-meter.ts'
import { type CredentialMappingChange } from '#universal/credential-contracts.ts'
import * as needsClosure from './credential-needs-closure.ts'
import { type CredentialNeed } from './credential-needs.ts'
import {
	resolveMappingChanges,
	writeMappingChanges,
} from './package-credential-mapping-changes.ts'
import {
	buildPackageCredentialsView,
	loadPackageMappingScope,
} from './package-credential-mappings.ts'

const mocks = vi.hoisted(() => ({ loadPackageManifestBySourceId: vi.fn() }))

vi.mock('#worker/package-registry/source.ts', () => ({
	loadPackageManifestBySourceId: mocks.loadPackageManifestBySourceId,
}))

const now = '2026-10-13T00:00:00.000Z'
const baseUrl = 'https://kody.test'

const needs: Array<CredentialNeed> = [
	{
		key: 'mail',
		kind: 'secret',
		provider: 'resend',
		description: 'Send the digest',
		multiple: false,
	},
	{
		key: 'chat',
		kind: 'secret',
		provider: 'slack',
		description: 'Post the digest',
		multiple: false,
	},
]

async function setup() {
	const sqlite = new DatabaseSync(':memory:')
	applyAllMigrations(sqlite, new URL('../../migrations/', import.meta.url))
	const db = createD1FromSqlite(sqlite)
	const env = {
		APP_DB: db,
		AUDIT_DB: createAuditTestDb(),
		...createInMemoryUserMeterEnv().env,
		COOKIE_SECRET: 'test-cookie-secret',
		SECRET_STORE_KEY: 'test-secret-store-key-32-chars-minimum',
	} as unknown as Env
	const people = Object.fromEntries(
		(['ann', 'bea', 'cy'] as const).map((username) => {
			const stableUserId = testStableUserIdFromEmail(`${username}@example.com`)
			return [
				username,
				{ stableUserId, personId: personIdFromStored(stableUserId) },
			]
		}),
	) as Record<
		'ann' | 'bea' | 'cy',
		{ stableUserId: string; personId: ReturnType<typeof personIdFromStored> }
	>
	for (const [username, person] of Object.entries(people)) {
		await provisionPersonalOrg(db, {
			stableUserId: person.stableUserId,
			username,
			createdAt: now,
		})
	}
	const created = await createOrganization(
		db,
		{} as Pick<Env, 'BUNDLE_ARTIFACTS_KV'>,
		{
			personId: people.bea.personId,
			audit: createTestOrgAuditWriter(),
			slug: 'acme-clients',
			displayName: 'Acme',
		},
	)
	if (!created.ok) throw new Error(created.error)
	const acme = await db
		.prepare(`SELECT id FROM orgs WHERE slug = 'acme-clients'`)
		.first<{ id: string }>()
	const acmeId = ownerIdFromStored(acme!.id)
	await db
		.prepare(
			`INSERT INTO org_memberships (org_id, user_id, role, created_at)
			 VALUES (?, ?, 'member', ?)`,
		)
		.bind(acmeId, people.ann.stableUserId, now)
		.run()
	const storeKey = async (name: string, provider: string) => {
		await saveSecret({ env, userId: acmeId, scope: 'user', name, value: 'v' })
		const row = await db
			.prepare(
				`UPDATE secret_entries SET provider = ?, allowed_hosts = '["api.example.com"]'
				WHERE name = ? AND bucket_id IN (
					SELECT id FROM secret_buckets WHERE user_id = ? AND scope = 'user'
				) RETURNING id`,
			)
			.bind(provider, name, acmeId)
			.first<{ id: string }>()
		return row!.id
	}
	const grantUse = async (
		credentialId: string,
		person: keyof typeof people,
	) => {
		await upsertGrant({
			db,
			orgId: acmeId,
			resourceType: 'credential',
			resourceId: credentialId,
			family: 'secret',
			subject: { type: 'user', id: people[person].stableUserId },
			preset: 'use',
			permissions: null,
			createdByUserId: people.bea.stableUserId,
			audit: createTestOrgAuditWriter(),
		})
		await db
			.prepare(`UPDATE orgs SET access_epoch = access_epoch + 1 WHERE id = ?`)
			.bind(acmeId)
			.run()
	}
	const packageId = crypto.randomUUID()
	await insertSavedPackage(
		db,
		{
			id: packageId,
			user_id: acmeId,
			name: '@acme/digest',
			kody_id: 'digest',
			description: 'test package',
			tags_json: '[]',
			search_text: null,
			source_id: `source-${packageId}`,
			has_app: 0,
			has_skills: 0,
			hidden: 0,
			is_private: 1,
			created_at: now,
			updated_at: now,
		},
		null,
		{ stamp: false },
	)
	const savedPackage = (await getSavedPackageById(db, {
		userId: acmeId,
		packageId,
	}))!
	mocks.loadPackageManifestBySourceId.mockResolvedValue({
		manifest: {
			name: '@acme/digest',
			kody: {
				id: 'digest',
				description: 'digest',
				jobs: {
					daily: {
						entry: './src/job.ts',
						schedule: { type: 'interval', every: '1d' },
					},
				},
				subscriptions: { 'acme.thing.happened': { handler: './src/h.ts' } },
				webhooks: [
					{ name: 'incoming', export: './webhook', responseMode: 'ack' },
				],
			},
		},
	})
	vi.spyOn(needsClosure, 'loadPublishedCredentialNeeds').mockResolvedValue(
		needs,
	)
	const requestAs = (person: keyof typeof people, role: OrgRole | null) =>
		deriveRequestContext({
			user: { userId: people[person].personId, username: person },
			source: { kind: 'session' },
			orgBinding: { org: { id: acmeId, slug: 'acme-clients' }, role },
		})
	const scopeFor = (person: keyof typeof people, role: OrgRole) =>
		loadPackageMappingScope({
			env,
			baseUrl,
			request: requestAs(person, role),
			savedPackage,
			canManage: role === 'owner',
		})
	const apply = async (
		person: keyof typeof people,
		role: OrgRole,
		changes: Array<CredentialMappingChange>,
	) => {
		const scope = await scopeFor(person, role)
		const resolved = await resolveMappingChanges(scope, changes)
		if (!resolved.some((change) => change.error)) {
			await writeMappingChanges(scope, resolved, now)
		}
		return resolved
	}
	const enablementCount = async () =>
		(await db
			.prepare(`SELECT COUNT(*) AS n FROM enablements WHERE package_id = ?`)
			.bind(packageId)
			.first<{ n: number }>())!.n
	return {
		db,
		env,
		people,
		acmeId,
		savedPackage,
		storeKey,
		grantUse,
		scopeFor,
		apply,
		enablementCount,
	}
}

const orgDefault = { type: 'default', layer: 'org' } as const
const mine = { type: 'default', layer: 'mine' } as const
const daily = {
	type: 'trigger',
	trigger: { kind: 'cron', name: 'daily' },
} as const

test('the view shows needs, options, triggers, and what is incomplete', async () => {
	const t = await setup()
	await t.storeKey('resend-prod', 'resend')
	await t.storeKey('resend-test', 'resend')
	const view = await buildPackageCredentialsView(
		await t.scopeFor('bea', 'owner'),
	)
	expect(view.package).toEqual({
		id: t.savedPackage.id,
		kodyId: 'digest',
		canManage: true,
	})
	const [mail, chat] = view.needs
	expect(mail).toMatchObject({
		key: 'mail',
		kind: 'secret',
		provider: 'resend',
		defaults: { org: null, mine: null },
		effective: { source: 'auto', status: 'ambiguous', credentials: [] },
	})
	expect(mail!.effective.candidates.map((ref) => ref.name)).toEqual([
		'resend-prod',
		'resend-test',
	])
	expect(mail!.options.map((ref) => ref.name)).toEqual([
		'resend-prod',
		'resend-test',
	])
	expect(new URL(mail!.createUrl).searchParams.get('forPackage')).toBe('digest')
	expect(chat!.effective).toMatchObject({ status: 'unbound', source: 'auto' })
	expect(chat!.effective.createUrl).toBe(chat!.createUrl)
	expect(
		view.triggers.map((trigger) => [
			trigger.trigger.kind,
			trigger.trigger.name,
			trigger.enablement,
			trigger.canEdit,
		]),
	).toEqual([
		['cron', 'daily', null, true],
		['subscription', 'acme.thing.happened', null, true],
		['webhook', 'incoming', null, false],
	])
	expect(view.triggers[2]!.instanceId).toBeNull()
	expect(view.incomplete).toEqual([
		{ needKey: 'mail', where: { type: 'default' }, status: 'ambiguous' },
		{ needKey: 'chat', where: { type: 'default' }, status: 'unbound' },
	])
})

test('one write sets defaults and a trigger mapping, turning the trigger on', async () => {
	const t = await setup()
	const prod = await t.storeKey('resend-prod', 'resend')
	const test_ = await t.storeKey('resend-test', 'resend')
	const resolved = await t.apply('bea', 'owner', [
		{
			target: orgDefault,
			needKey: 'mail',
			credentials: [{ name: 'resend-prod', scope: 'org' }],
		},
		{ target: mine, needKey: 'chat', credentials: [] },
		{ target: daily, needKey: 'mail', credentials: [{ id: test_ }] },
	])
	expect(resolved.map((change) => [change.error, change.willEnable])).toEqual([
		[null, false],
		[null, false],
		[null, true],
	])
	expect(await t.enablementCount()).toBe(1)

	const view = await buildPackageCredentialsView(
		await t.scopeFor('bea', 'owner'),
	)
	const [mail, chat] = view.needs
	expect(mail!.defaults.org).toMatchObject({
		credentials: [
			{ id: prod, name: 'resend-prod', scope: 'org', kind: 'secret' },
		],
		unusableIds: [],
		updatedAt: now,
	})
	expect(mail!.effective).toMatchObject({ source: 'org', status: 'ready' })
	expect(chat!.defaults.mine?.credentials).toEqual([])
	expect(chat!.effective).toMatchObject({ source: 'mine', status: 'none' })
	const trigger = view.triggers[0]!
	expect(trigger.enablement).toMatchObject({ state: 'on', enabledByYou: true })
	expect(trigger.mappings[0]).toMatchObject({
		needKey: 'mail',
		override: { credentials: [{ id: test_ }] },
		effective: {
			source: 'trigger',
			status: 'ready',
			credentials: [{ id: test_ }],
		},
	})
	expect(trigger.mappings[1]!.effective).toMatchObject({
		source: 'mine',
		status: 'none',
	})
	expect(view.incomplete).toEqual([])

	// A second write reuses the enablement and clearing restores inheritance.
	await t.apply('bea', 'owner', [
		{ target: daily, needKey: 'mail', credentials: null },
	])
	expect(await t.enablementCount()).toBe(1)
	const cleared = await buildPackageCredentialsView(
		await t.scopeFor('bea', 'owner'),
	)
	expect(cleared.triggers[0]!.mappings[0]).toMatchObject({
		override: null,
		effective: { source: 'org', status: 'ready', credentials: [{ id: prod }] },
	})
})

test('changes that cannot apply carry a coded error and nothing is written', async () => {
	const t = await setup()
	const prod = await t.storeKey('resend-prod', 'resend')
	await t.storeKey('slack-bot', 'slack')
	await t.grantUse(prod, 'ann')
	const resolved = await t.apply('ann', 'member', [
		{
			target: orgDefault,
			needKey: 'mail',
			credentials: [{ name: 'resend-prod' }],
		},
		{ target: mine, needKey: 'nope', credentials: [] },
		{ target: mine, needKey: 'chat', credentials: [{ name: 'slack-bot' }] },
		{ target: mine, needKey: 'mail', credentials: [{ name: 'org:missing' }] },
		{
			target: mine,
			needKey: 'mail',
			credentials: [{ name: 'resend-prod' }, { name: 'resend-prod' }],
		},
		{
			target: {
				type: 'trigger',
				trigger: { kind: 'webhook', name: 'incoming' },
			},
			needKey: 'mail',
			credentials: [{ name: 'resend-prod' }],
		},
		{
			target: { type: 'trigger', trigger: { kind: 'cron', name: 'weekly' } },
			needKey: 'mail',
			credentials: [{ name: 'resend-prod' }],
		},
		{ target: daily, needKey: 'mail', credentials: [{ name: 'resend-prod' }] },
	])
	expect(resolved.map((change) => change.error?.code ?? null)).toEqual([
		'not_allowed',
		'need_unknown',
		'credential_not_found',
		'credential_not_found',
		'too_many',
		'webhook_not_minted',
		'trigger_unknown',
		null,
	])
	expect(resolved[3]!.error?.createUrl).toContain('/connect/credential?')
	expect(resolved[7]).toMatchObject({ willEnable: true, after: [{ id: prod }] })
	expect(await t.enablementCount()).toBe(0)
	await expect(
		writeMappingChanges(await t.scopeFor('ann', 'member'), resolved),
	).rejects.toThrow(/errors/)

	const mismatch = await t.apply('bea', 'owner', [
		{ target: mine, needKey: 'mail', credentials: [{ name: 'slack-bot' }] },
	])
	expect(mismatch[0]!.error).toMatchObject({ code: 'provider_mismatch' })
})

test('the viewer scope binds the :username org and needs package:execute', async () => {
	const t = await setup()
	const viewer = (person: keyof typeof t.people) => ({
		mcpUser: {
			userId: t.people[person].personId,
			email: `${person}@example.com`,
			displayName: person,
		},
	})
	const load = (
		person: keyof typeof t.people,
		username: string,
		kodyId: string,
	) =>
		loadPackageMappingScopeForViewer({
			env: t.env,
			request: new Request(
				`${baseUrl}/profiles/${username}/packages/${kodyId}/credentials.json`,
			),
			user: viewer(person) as never,
			username,
			kodyId,
		})
	const owner = await load('bea', 'acme-clients', 'digest')
	expect(owner).toMatchObject({
		canManage: true,
		actorId: t.people.bea.personId,
	})
	expect(owner!.request.org.id).toBe(t.acmeId as OwnerId)
	// A private package needs a grant before a member can run it.
	expect(await load('ann', 'acme-clients', 'digest')).toBeNull()
	await upsertGrant({
		db: t.db,
		orgId: t.acmeId,
		resourceType: 'package',
		resourceId: t.savedPackage.id,
		family: 'package',
		subject: { type: 'user', id: t.people.ann.stableUserId },
		preset: 'use',
		permissions: null,
		createdByUserId: t.people.bea.stableUserId,
		audit: createTestOrgAuditWriter(),
	})
	await t.db
		.prepare(`UPDATE orgs SET access_epoch = access_epoch + 1 WHERE id = ?`)
		.bind(t.acmeId)
		.run()
	const member = await load('ann', 'acme-clients', 'digest')
	expect(member?.canManage).toBe(false)
	expect(await load('cy', 'acme-clients', 'digest')).toBeNull()
	expect(await load('bea', 'acme-clients', 'missing')).toBeNull()
	expect(await load('bea', 'ann', 'digest')).toBeNull()
})
