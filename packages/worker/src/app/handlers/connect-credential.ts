import { type Action } from 'remix/router'
import { loadAccountCredentialsData } from '#app/account-credentials-data.ts'
import { requireAuthenticatedPageUser } from '#app/page-auth.ts'
import { renderAppPage } from '#app/ssr-render.tsx'
import { type routes } from '#universal/routes.ts'

/**
 * The credential creation link agents hand out. The page reads the link's
 * query itself; the list lets it point at credentials that already fit.
 */
export function createConnectCredentialHandler(env: Env) {
	return {
		middleware: [],
		async handler({ request }) {
			const user = await requireAuthenticatedPageUser(request, env)
			if (user instanceof Response) {
				return user
			}
			const accountCredentials = await loadAccountCredentialsData({
				env,
				user,
			})
			return renderAppPage({
				request,
				env,
				title: 'Add a credential',
				loaderData: { accountCredentials },
			})
		},
	} satisfies Action<typeof routes.connectCredential>
}
