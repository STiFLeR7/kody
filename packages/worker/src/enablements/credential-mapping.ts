/**
 * Enablement credential snapshots (ADR 0068). Enabling resolves the
 * package's needs once to credential ids, so a trigger's runs never drift to a
 * credential added later. Only the enabler changes them (`enablementUpdate`).
 *
 * Runs check the snapshot before they start: a stored credential the enabler
 * can no longer use, or a need a republish added that has no single
 * candidate, pauses the enablement until the cause clears.
 */
import { personalOrgId } from '@kody-internal/shared/owner-person-ids.ts'
import { type RequestContext } from '@kody-internal/shared/request-context.ts'
import {
	findCredentialById,
	listUsableCredentials,
	resolveNeedCandidates,
	type UsableCredential,
} from '#worker/credentials/credential-candidates.ts'
import { type CredentialCallMap } from '#worker/credentials/credential-call-map.ts'
import {
	credentialClientRefusal,
	loadPackageNeeds,
	needTarget,
	pickCandidate,
	pickExplicit,
} from '#worker/credentials/credential-client.ts'
import {
	enablementCredentialPause,
	enablementNeedPause,
} from './credential-pause.ts'
import { type EnablementPauseInput } from './repo.ts'
import {
	type EnablementCredentialMapping,
	type EnablementRecord,
} from './types.ts'

function toPick(credential: UsableCredential) {
	return { id: credential.id, scope: credential.scope }
}

/**
 * Resolves a package's needs to credential ids for an enablement.
 *
 * - With a map (or an `existing` snapshot to update), every need must
 *   resolve: a map key the package does not declare, a bad pick, or an
 *   ambiguous or unbound need is an error, as for an invoke.
 * - With neither, needs that auto-resolve are stored. If any need has no
 *   single candidate, nothing is stored and each run resolves its needs then,
 *   as before snapshots; the warning says how to pin them.
 */
export async function snapshotEnablementCredentials(input: {
	env: Env
	request: RequestContext
	packageId: string
	map: CredentialCallMap | null
	existing?: EnablementCredentialMapping | null
}): Promise<{
	mapping: EnablementCredentialMapping | null
	warnings: Array<string>
}> {
	const { map, existing } = input
	const needs = await loadPackageNeeds(input)
	const declared = new Set(needs.map((need) => need.key))
	for (const key of map?.keys() ?? []) {
		if (!declared.has(key)) {
			throw credentialClientRefusal(
				'credential_need_unknown',
				`credentials.${key} is not a need of this package${
					declared.size > 0 ? ` (declared: ${[...declared].join(', ')})` : ''
				}.`,
			)
		}
	}
	if (needs.length === 0) return { mapping: null, warnings: [] }
	const strict = Boolean(map) || Boolean(existing)
	const usable = await listUsableCredentials(input)
	const mapping: EnablementCredentialMapping = {}
	const unresolved: Array<string> = []
	for (const need of needs) {
		const key = need.key
		const picks = map?.get(key)
		if (picks) {
			if (!need.multiple && picks.length > 1) {
				throw credentialClientRefusal(
					'invalid_request',
					`credentials.${key} picks ${picks.length} credentials, but need "${key}" takes one.`,
				)
			}
			const target = needTarget(key, need)
			const ids = new Map<string, { id: string; scope: 'org' | 'personal' }>()
			for (const pick of picks) {
				const { credential } = pickExplicit({ key, pick, usable, target })
				ids.set(credential.id, toPick(credential))
			}
			mapping[key] = [...ids.values()]
			continue
		}
		const kept = existing?.[key]
		if (kept) {
			const usableNow = kept.every((pick) =>
				usable.some(
					(credential) =>
						credential.id === pick.id && credential.scope === pick.scope,
				),
			)
			if (!usableNow) {
				// Never re-point a stored need the enabler did not name.
				throw credentialClientRefusal(
					'credential_unbound',
					`The credential this enablement stored for "${key}" is deleted or no longer usable by you. Pick one in credentials.${key}.`,
					{
						retryWith: resolveNeedCandidates(need, usable).options.map(
							(credential) => ({
								credentials: {
									[key]: { name: credential.name, scope: credential.scope },
								},
							}),
						),
					},
				)
			}
			mapping[key] = kept
			continue
		}
		if (strict) {
			mapping[key] = [
				toPick(pickCandidate({ key, target: needTarget(key, need), usable })),
			]
			continue
		}
		const { autoPick } = resolveNeedCandidates(need, usable)
		if (autoPick) mapping[key] = [toPick(autoPick)]
		else unresolved.push(key)
	}
	if (unresolved.length > 0) {
		return {
			mapping: null,
			warnings: [
				`No credentials were stored for this enablement: ${unresolved.join(', ')} ${
					unresolved.length === 1 ? 'has' : 'have'
				} no single credential you can use, so each run resolves its needs when it runs. Pick with enablementUpdate { credentials } to store them.`,
			],
		}
	}
	return { mapping, warnings: [] }
}

/**
 * The pause a run of this enablement needs before it starts, or null when its
 * stored credentials are all usable and every need it stored nothing for
 * (added by a republish) still has one candidate. Enablements with no
 * snapshot resolve on each run and are not checked here.
 */
export async function checkEnablementCredentials(input: {
	env: Env
	request: RequestContext
	enablement: EnablementRecord
}): Promise<EnablementPauseInput | null> {
	const { enablement } = input
	const mapping = enablement.credentialMapping
	if (!mapping || !enablement.packageId) return null
	const usable = await listUsableCredentials(input)
	for (const [key, picks] of Object.entries(mapping)) {
		for (const pick of picks) {
			const live = usable.some(
				(credential) =>
					credential.id === pick.id && credential.scope === pick.scope,
			)
			if (live) continue
			const credential = await findCredentialById({
				db: input.env.APP_DB,
				ownerId:
					pick.scope === 'org'
						? enablement.orgId
						: personalOrgId(enablement.enablerUserId),
				id: pick.id,
				scope: pick.scope,
			})
			return enablementCredentialPause({ key, id: pick.id, credential })
		}
	}
	const needs = await loadPackageNeeds({
		env: input.env,
		request: input.request,
		packageId: enablement.packageId,
	})
	for (const need of needs) {
		if (Object.hasOwn(mapping, need.key)) continue
		if (!resolveNeedCandidates(need, usable).autoPick) {
			return enablementNeedPause(need.key)
		}
	}
	return null
}
