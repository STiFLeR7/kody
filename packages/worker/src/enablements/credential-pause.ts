import { type UsableCredential } from '#worker/credentials/credential-candidates.ts'
import { type EnablementPauseInput } from './repo.ts'
import {
	type EnablementCredentialMapping,
	type EnablementRecord,
} from './types.ts'

/** A pause on a need the enablement stored no credential for. */
export const enablementNeedPauseResourceType = 'credential-need'

/**
 * The pause for a stored credential the enabler can no longer use (lost Use,
 * revoked grant, or deleted). It waits on the stored id, not on a name.
 */
export function enablementCredentialPause(input: {
	key: string
	id: string
	credential: UsableCredential | null
}): EnablementPauseInput {
	const kind = input.credential?.kind
	const family = kind === 'oauth' || kind === 'mcp' ? 'integration' : 'secret'
	return {
		reason: 'credential_access',
		permission: `${family}:use`,
		resourceType: family,
		resourceId: input.credential?.name ?? input.key,
		credentialId: input.id,
	}
}

/** The pause for a need a republish added that has no single candidate. */
export function enablementNeedPause(key: string): EnablementPauseInput {
	return {
		reason: 'credential_access',
		permission: null,
		resourceType: enablementNeedPauseResourceType,
		resourceId: key,
		credentialId: null,
	}
}

function storesCredential(mapping: EnablementCredentialMapping, id: string) {
	return Object.values(mapping).some((picks) =>
		picks.some((pick) => pick.id === id),
	)
}

/**
 * Whether the enablement is paused on its stored credentials, which the
 * mapping check decides instead of the permission on a stored resource.
 */
export function pausedOnCredentialMapping(enablement: EnablementRecord) {
	const { pause, credentialMapping } = enablement
	if (pause?.reason !== 'credential_access' || !credentialMapping) return false
	if (pause.resourceType === enablementNeedPauseResourceType) return true
	return Boolean(
		pause.credentialId &&
		storesCredential(credentialMapping, pause.credentialId),
	)
}
