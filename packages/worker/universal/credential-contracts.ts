/**
 * Shared shapes and URL codecs for credential mappings, the approval page,
 * and credential creation links. The contract is
 * docs/contributing/contracts/credential-mappings-api.md; the client and the
 * server both import these so neither drifts from it.
 *
 * Nothing here carries a credential value.
 */

export const credentialKinds = [
	'secret',
	'oauth',
	'mcp',
	'url',
	'login',
	'signing',
] as const
export type CredentialKind = (typeof credentialKinds)[number]

export function isCredentialKind(value: unknown): value is CredentialKind {
	return (credentialKinds as ReadonlyArray<unknown>).includes(value)
}

/** Kinds a need without a declared `kind` accepts (any fetch-capable one). */
export const fetchCapableCredentialKinds = [
	'secret',
	'oauth',
	'login',
	'url',
] as const satisfies ReadonlyArray<CredentialKind>

export const credentialScopes = ['org', 'personal'] as const
export type CredentialScope = (typeof credentialScopes)[number]

export type CredentialRef = {
	id: string
	name: string
	scope: CredentialScope
	kind: CredentialKind
}

/** A pick as an agent or a form sends it: by name (optionally scoped) or id. */
export type CredentialPick =
	| { name: string; scope?: CredentialScope }
	| { id: string }

export const credentialMappingLayers = ['org', 'mine'] as const
export type CredentialMappingLayer = (typeof credentialMappingLayers)[number]

export const credentialTriggerKinds = [
	'cron',
	'subscription',
	'webhook',
] as const
export type CredentialTriggerKind = (typeof credentialTriggerKinds)[number]
export type CredentialTriggerRef = { kind: CredentialTriggerKind; name: string }

export type StoredCredentialMapping = {
	/** `[]` is "none on purpose". */
	credentials: Array<CredentialRef>
	/** Refs the viewer can no longer Use (deleted or Use revoked); ids only. */
	unusableIds: Array<string>
	updatedAt: string
	updatedBy: { username: string } | null
}

export type CredentialMappingSource =
	| 'call'
	| 'trigger'
	| 'mine'
	| 'org'
	| 'auto'
	| 'none'

export type EffectiveCredentialMappingStatus =
	| 'ready'
	| 'none'
	| 'unbound'
	| 'ambiguous'
	| 'unusable'

export type EffectiveCredentialMapping = {
	source: CredentialMappingSource
	status: EffectiveCredentialMappingStatus
	credentials: Array<CredentialRef>
	candidates: Array<CredentialRef>
	/** Absolute creation link; set when status is not `ready`. */
	createUrl: string | null
}

export type CredentialMappingTarget =
	| { type: 'default'; layer: CredentialMappingLayer }
	| { type: 'trigger'; trigger: CredentialTriggerRef }

export type CredentialMappingChange = {
	target: CredentialMappingTarget
	needKey: string
	/** `null` clears the override (inherit); `[]` is "none on purpose". */
	credentials: Array<CredentialPick> | null
}

/** A proposed change always sets picks; proposals cannot clear. */
export type CredentialMappingProposalChange = CredentialMappingChange & {
	credentials: Array<CredentialPick>
}

export type CredentialInjectView =
	| { kind: 'header'; name: string; format: string }
	| { kind: 'basic'; valueAs: 'username' | 'password'; other: string }
	| { kind: 'query'; param: string }

export type CredentialListItemStatus =
	| 'ok'
	| 'expired'
	| 'needs_attention'
	| 'disabled'

export type CredentialListItem = {
	id: string
	kind: CredentialKind
	name: string
	scope: CredentialScope
	provider: string | null
	description: string
	hosts: Array<string>
	inject: CredentialInjectView | null
	packageId: string | null
	lockedToPackageIds: Array<string>
	expiresAt: string | null
	createdAt: string
	updatedAt: string
	status: CredentialListItemStatus
	statusMessage: string | null
	mcp: { url: string; enabled: boolean } | null
}

export type CredentialListFilters = {
	q?: string
	kinds?: Array<CredentialKind>
	scope?: CredentialScope
	packageScoped?: boolean
	/** `true`: locked to any package; a string: locked to that package id. */
	locked?: true | string
}

export type CredentialListResponse = {
	ok: true
	credentials: Array<CredentialListItem>
}

export type PackageCredentialNeedView = {
	key: string
	kind: CredentialKind | null
	provider: string
	description: string
	multiple: boolean
	from?: string
	defaults: {
		org: StoredCredentialMapping | null
		mine: StoredCredentialMapping | null
	}
	effective: EffectiveCredentialMapping
	options: Array<CredentialRef>
	createUrl: string
}

export type PackageTriggerView = {
	trigger: CredentialTriggerRef
	instanceId: string | null
	enablement: {
		id: string
		state: 'on' | 'paused' | 'off'
		enabledByYou: boolean
	} | null
	canEdit: boolean
	mappings: Array<{
		needKey: string
		override: StoredCredentialMapping | null
		effective: EffectiveCredentialMapping
	}>
}

export type PackageCredentialsIncomplete = {
	needKey: string
	where:
		| { type: 'default' }
		| { type: 'trigger'; trigger: CredentialTriggerRef }
	status: 'unbound' | 'ambiguous' | 'unusable'
}

export type PackageCredentialsView = {
	ok: true
	package: { id: string; kodyId: string; canManage: boolean }
	needs: Array<PackageCredentialNeedView>
	triggers: Array<PackageTriggerView>
	locked: Array<CredentialListItem>
	incomplete: Array<PackageCredentialsIncomplete>
}

export const credentialApprovalErrorCodes = [
	'need_unknown',
	'trigger_unknown',
	'credential_not_found',
	'credential_ambiguous',
	'kind_mismatch',
	'provider_mismatch',
	'too_many',
	'not_allowed',
	'webhook_not_minted',
	'webhook_other_enabler',
] as const
export type CredentialApprovalErrorCode =
	(typeof credentialApprovalErrorCodes)[number]

export type CredentialApprovalChangeView = {
	target: CredentialMappingTarget
	needKey: string
	need: {
		kind: CredentialKind | null
		provider: string
		description: string
		multiple: boolean
	} | null
	before: Array<CredentialRef> | null
	after: Array<CredentialRef>
	willEnable: boolean
	error: {
		code: CredentialApprovalErrorCode
		message: string
		createUrl?: string
	} | null
}

export type CredentialApprovalView = {
	ok: true
	package: { id: string; kodyId: string }
	reason: string | null
	canApprove: boolean
	fingerprint: string
	changes: Array<CredentialApprovalChangeView>
	errors: Array<string>
}

export function describeCredentialMappingTarget(
	target: CredentialMappingTarget,
): string {
	switch (target.type) {
		case 'default':
			return target.layer === 'org' ? 'org default' : 'your default'
		case 'trigger':
			return `${target.trigger.kind} "${target.trigger.name}"`
		default: {
			const exhaustive: never = target
			throw new Error(`Unhandled mapping target: ${String(exhaustive)}`)
		}
	}
}

// ---------------------------------------------------------------------------
// Creation link: /connect/credential
// ---------------------------------------------------------------------------

export const credentialCreatePath = '/connect/credential'

export type CredentialKindMode = 'hint' | 'required'

export type CredentialCreateLinkInput = {
	kind?: CredentialKind | null
	kindMode?: CredentialKindMode
	name?: string | null
	provider?: string | null
	description?: string | null
	allowedHosts?: ReadonlyArray<string>
	/** The package (kody id) and need key the credential is for. */
	packageKodyId?: string | null
	needKey?: string | null
	/** Passed through to the reused form (secret-set or OAuth params). */
	extra?: Record<string, string>
}

const createLinkKnownParams = new Set([
	'kind',
	'kindMode',
	'name',
	'provider',
	'description',
	'allowedHosts',
	'package',
	'need',
])

function trimmed(value: string | null | undefined) {
	const text = value?.trim()
	return text ? text : null
}

export function buildCredentialCreateHref(
	input: CredentialCreateLinkInput,
): string {
	const params = new URLSearchParams()
	const kind = input.kind ?? null
	if (kind) {
		params.set('kind', kind)
		if (input.kindMode === 'required') params.set('kindMode', 'required')
	}
	const set = (key: string, value: string | null | undefined) => {
		const text = trimmed(value)
		if (text) params.set(key, text)
	}
	set('name', input.name)
	set('provider', input.provider)
	set('description', input.description)
	const hosts = (input.allowedHosts ?? [])
		.map((host) => host.trim())
		.filter(Boolean)
	if (hosts.length > 0) params.set('allowedHosts', hosts.join(','))
	set('package', input.packageKodyId)
	set('need', input.needKey)
	for (const [key, value] of Object.entries(input.extra ?? {})) {
		if (createLinkKnownParams.has(key)) continue
		params.set(key, value)
	}
	const query = params.toString()
	return query ? `${credentialCreatePath}?${query}` : credentialCreatePath
}

/** The creation link as an absolute URL on `baseUrl`'s origin. */
export function buildCredentialCreateUrl(
	baseUrl: string,
	input: CredentialCreateLinkInput,
): string {
	return new URL(buildCredentialCreateHref(input), baseUrl).toString()
}

export type ParsedCredentialCreateQuery = {
	kind: CredentialKind | null
	/** True only when `kindMode=required` and `kind` is a known kind. */
	kindLocked: boolean
	name: string | null
	provider: string | null
	description: string | null
	allowedHosts: Array<string>
	packageKodyId: string | null
	needKey: string | null
	/** Every other param, for the reused form. */
	passthrough: URLSearchParams
}

export function parseCredentialCreateQuery(
	search: URLSearchParams,
): ParsedCredentialCreateQuery {
	const rawKind = trimmed(search.get('kind'))
	const kind = isCredentialKind(rawKind) ? rawKind : null
	const passthrough = new URLSearchParams()
	for (const [key, value] of search) {
		if (!createLinkKnownParams.has(key)) passthrough.append(key, value)
	}
	return {
		kind,
		kindLocked: kind !== null && search.get('kindMode') === 'required',
		name: trimmed(search.get('name')),
		provider: trimmed(search.get('provider')),
		description: trimmed(search.get('description')),
		allowedHosts: search
			.getAll('allowedHosts')
			.flatMap((value) => value.split(','))
			.map((host) => host.trim())
			.filter(Boolean),
		packageKodyId: trimmed(search.get('package')),
		needKey: trimmed(search.get('need')),
		passthrough,
	}
}

/**
 * Where `/connect/credential` sends a visit until the one-pager ships: the
 * existing page for the kind, with the same query.
 */
export function credentialCreateInterimHref(input: {
	search: URLSearchParams
	orgSlug: string | null
}): string {
	const parsed = parseCredentialCreateQuery(input.search)
	const query = input.search.toString()
	const withQuery = (path: string) => (query ? `${path}?${query}` : path)
	switch (parsed.kind) {
		case 'oauth':
			return withQuery('/connect/oauth')
		case 'mcp':
			return input.orgSlug
				? `/@${encodeURIComponent(input.orgSlug)}/-/mcp-servers`
				: '/account'
		case 'secret':
		case 'url':
		case 'login':
		case 'signing':
		case null:
			return withQuery('/connect/secret-set')
		default: {
			const exhaustive: never = parsed.kind
			throw new Error(`Unhandled credential kind: ${String(exhaustive)}`)
		}
	}
}

// ---------------------------------------------------------------------------
// Proposal / approval link: /@:username/:kodyId/approve-credentials
// ---------------------------------------------------------------------------

export const maxCredentialProposalValues = 64
const maxCredentialProposalReasonLength = 500

function credentialApprovalPath(input: {
	username: string
	kodyId: string
}): string {
	return `/@${encodeURIComponent(input.username)}/${encodeURIComponent(input.kodyId)}/approve-credentials`
}

function formatCredentialPick(pick: CredentialPick): string {
	if ('id' in pick) return `id:${pick.id}`
	return pick.scope ? `${pick.scope}:${pick.name}` : pick.name
}

export function parseCredentialPick(value: string): CredentialPick | null {
	const text = value.trim()
	if (!text) return null
	const colon = text.indexOf(':')
	if (colon > 0) {
		const prefix = text.slice(0, colon)
		const rest = text.slice(colon + 1).trim()
		if (prefix === 'id') return rest ? { id: rest } : null
		if (prefix === 'org' || prefix === 'personal') {
			return rest ? { name: rest, scope: prefix } : null
		}
	}
	return { name: text }
}

function proposalParamName(change: CredentialMappingChange): string {
	const { target } = change
	switch (target.type) {
		case 'default':
			return `${target.layer === 'org' ? 'default' : 'mine'}[${change.needKey}]`
		case 'trigger':
			return `trigger[${target.trigger.kind}:${target.trigger.name}][${change.needKey}]`
		default: {
			const exhaustive: never = target
			throw new Error(`Unhandled mapping target: ${String(exhaustive)}`)
		}
	}
}

function buildCredentialProposalSearch(input: {
	changes: ReadonlyArray<CredentialMappingProposalChange>
	reason?: string | null
}): URLSearchParams {
	const params = new URLSearchParams()
	for (const change of input.changes) {
		const name = proposalParamName(change)
		if (change.credentials.length === 0) {
			params.append(name, '')
			continue
		}
		for (const pick of change.credentials) {
			params.append(name, formatCredentialPick(pick))
		}
	}
	const reason = trimmed(input.reason)
	if (reason) {
		params.set('reason', reason.slice(0, maxCredentialProposalReasonLength))
	}
	return params
}

export function buildCredentialApprovalHref(input: {
	username: string
	kodyId: string
	changes: ReadonlyArray<CredentialMappingProposalChange>
	reason?: string | null
}): string {
	const path = credentialApprovalPath(input)
	const query = buildCredentialProposalSearch(input).toString()
	return query ? `${path}?${query}` : path
}

export type ParsedCredentialProposal = {
	changes: Array<CredentialMappingProposalChange>
	reason: string | null
	errors: Array<string>
}

const defaultParamPattern = /^(default|mine)\[([^\]]+)\]$/
const triggerParamPattern =
	/^trigger\[(cron|subscription|webhook):([^\]]+)\]\[([^\]]+)\]$/

function parseProposalParamName(
	name: string,
): Omit<CredentialMappingProposalChange, 'credentials'> | null {
	const defaultMatch = defaultParamPattern.exec(name)
	if (defaultMatch) {
		const [, layer, needKey] = defaultMatch
		return {
			target: { type: 'default', layer: layer === 'default' ? 'org' : 'mine' },
			needKey: needKey!.trim(),
		}
	}
	const triggerMatch = triggerParamPattern.exec(name)
	if (triggerMatch) {
		const [, kind, triggerName, needKey] = triggerMatch
		return {
			target: {
				type: 'trigger',
				trigger: {
					kind: kind as CredentialTriggerKind,
					name: triggerName!.trim(),
				},
			},
			needKey: needKey!.trim(),
		}
	}
	return null
}

/**
 * Reads a proposal from the approval page's query. Values for one param
 * accumulate in order; a lone empty value maps the need to `[]`. Params that
 * look like mapping params but do not parse are reported, other params are
 * ignored.
 */
export function parseCredentialApprovalQuery(
	search: URLSearchParams,
): ParsedCredentialProposal {
	const errors: Array<string> = []
	const byParam = new Map<string, CredentialMappingProposalChange>()
	let valueCount = 0
	for (const [name, value] of search) {
		if (name === 'reason') continue
		const parsed = parseProposalParamName(name)
		if (!parsed) {
			if (/^(default|mine|trigger)/.test(name)) {
				errors.push(`"${name}" is not a mapping parameter.`)
			}
			continue
		}
		const triggerName =
			parsed.target.type === 'trigger' ? parsed.target.trigger.name : null
		if (!parsed.needKey || triggerName === '') {
			errors.push(`"${name}" is missing a name.`)
			continue
		}
		valueCount += 1
		const change = byParam.get(name) ?? { ...parsed, credentials: [] }
		byParam.set(name, change)
		const pick = parseCredentialPick(value)
		if (pick) change.credentials.push(pick)
	}
	if (valueCount > maxCredentialProposalValues) {
		return {
			changes: [],
			reason: null,
			errors: [
				`A proposal holds at most ${maxCredentialProposalValues} mapping values; this one has ${valueCount}.`,
			],
		}
	}
	const reason = trimmed(search.get('reason'))
	return {
		changes: [...byParam.values()],
		reason: reason ? reason.slice(0, maxCredentialProposalReasonLength) : null,
		errors,
	}
}
