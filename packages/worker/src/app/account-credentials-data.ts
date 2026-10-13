import { personalOrgId } from '@kody-internal/shared/owner-person-ids.ts'
import { type AuthenticatedAppUser } from '#app/authenticated-user.ts'
import { loadCredentialDetail } from '#worker/credentials/credential-detail.ts'
import { listOrgCredentials } from '#worker/credentials/credential-list.ts'
import { loadOrgBindingForOrg } from '#worker/orgs/repo.ts'
import { listSavedPackagesByUserId } from '#worker/package-registry/repo.ts'
import { ownerIdFromCaller } from '#worker/request-context/owner-id.ts'
import { type CredentialListFilters } from '#universal/credential-contracts.ts'
import {
	type AccountCredentialsResponse,
	filterCredentialListItems,
} from '#universal/credentials-list.ts'

/** The Credentials list for the org this request is bound to. */
export async function loadAccountCredentialsData(input: {
	env: Env
	user: AuthenticatedAppUser
	filters?: CredentialListFilters
	/** A credential id to load the detail pane for. */
	selectedId?: string | null
}): Promise<AccountCredentialsResponse> {
	const orgId = ownerIdFromCaller({
		request: input.user.request,
		user: input.user.mcpUser,
	})
	const viewer = input.user.mcpUser.userId
	const personalId = personalOrgId(viewer)
	const teamOrg = orgId !== personalId
	const orgSlug = input.user.request.org.slug ?? input.user.username
	const [personalOrgSlug, listed, packages] = await Promise.all([
		teamOrg
			? loadOrgBindingForOrg(input.env.APP_DB, viewer, personalId).then(
					(binding) => binding?.org.slug ?? null,
				)
			: orgSlug,
		listOrgCredentials({ db: input.env.APP_DB, orgId, viewerPersonId: viewer }),
		listSavedPackagesByUserId(input.env.APP_DB, { userId: orgId }),
	])
	const selectedItem = input.selectedId
		? listed.credentials.find((item) => item.id === input.selectedId)
		: undefined
	const selected = selectedItem
		? await loadCredentialDetail({
				env: input.env,
				request: input.user.request,
				orgId,
				credential: selectedItem,
				packages,
			})
		: null
	return {
		ok: true,
		selected,
		credentials: input.filters
			? filterCredentialListItems(listed.credentials, input.filters)
			: listed.credentials,
		orgSlug,
		personalOrgSlug,
		teamOrg,
		providers: listed.providers,
		packages: packages.map((row) => ({
			id: row.id,
			kodyId: row.kodyId,
			name: row.name,
		})),
	}
}
