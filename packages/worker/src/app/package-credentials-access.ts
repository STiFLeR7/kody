import { type readAuthenticatedAppUser } from '#app/authenticated-user.ts'
import { getAppBaseUrl } from '#worker/app-base-url.ts'
import {
	checkPermission,
	computeEffectivePermissions,
	packageResource,
} from '#worker/authorization/authorize.ts'
import {
	loadPackageMappingScope,
	type PackageMappingScope,
} from '#worker/credentials/package-credential-mappings.ts'
import { loadOrgBindingForSlug } from '#worker/orgs/repo.ts'
import { resolveSavedPackage } from '#worker/package-invocations/module-artifacts.ts'
import { deriveRequestContext } from '#worker/request-context/request-context.ts'

type AppUser = NonNullable<Awaited<ReturnType<typeof readAuthenticatedAppUser>>>

/**
 * The mapping scope for `/profiles/:username/packages/:kodyId/…` as the
 * signed-in person sees it, bound to the `:username` org. Null when the org
 * or package is not theirs to see, or they lack `package:execute` on it, so
 * callers answer 404 without leaking which.
 */
export async function loadPackageMappingScopeForViewer(input: {
	env: Env
	request: Request
	user: AppUser
	username: string
	kodyId: string
}): Promise<PackageMappingScope | null> {
	const { env, user } = input
	const binding = await loadOrgBindingForSlug(
		env.APP_DB,
		user.mcpUser.userId,
		input.username,
	)
	if (!binding) return null
	const savedPackage = await resolveSavedPackage({
		db: env.APP_DB,
		userId: binding.org.id,
		packageIdOrKodyId: input.kodyId.trim(),
	})
	if (!savedPackage) return null
	const request = deriveRequestContext({
		user: user.mcpUser,
		source: { kind: 'session' },
		orgBinding: binding,
	})
	const access = await computeEffectivePermissions({ env, request })
	const resource = packageResource({
		id: savedPackage.id,
		userId: savedPackage.userId,
		label: savedPackage.kodyId,
	})
	if (!checkPermission(access, 'package:execute', resource).allowed) {
		return null
	}
	return await loadPackageMappingScope({
		env,
		baseUrl: getAppBaseUrl({ env, requestUrl: input.request.url }),
		request,
		savedPackage,
		canManage: checkPermission(access, 'package:write', resource).allowed,
	})
}
