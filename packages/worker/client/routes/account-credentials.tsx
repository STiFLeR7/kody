import { type Handle, css } from 'remix/component'
import { readCurrentRouterHref } from '#client/client-router.tsx'
import { Combobox, type ComboboxOption } from '#client/combobox.tsx'
import { replaceLocation } from '#client/replace-location.ts'
import { createRouteData, routeDataRedirect } from '#client/route-data.tsx'
import { type AccountStatus } from '#client/routes/account-approval-shared.ts'
import {
	AccountManagementMessage,
	AccountManagementShell,
	AccountPageHeader,
} from '#client/routes/account-management-components.tsx'
import {
	type CredentialListFilters,
	fetchAccountCredentials,
	filterCredentialList,
	readCredentialListFilters,
	writeCredentialListFilters,
} from '#client/routes/account-credentials-shared.ts'
import {
	RecordTable,
	RecordTableSearch,
	RecordTableSelect,
	recordCellClamp,
} from '#client/routes/record-table.tsx'
import {
	type AccountCredentialListItem,
	type AccountCredentialsLoaderData,
	credentialKindLabel,
	credentialListKinds,
	credentialStatusLabel,
} from '#universal/credentials-list.ts'
import { orgResourcePath } from '#universal/org-pages.ts'
import { routes } from '#universal/routes.ts'
import {
	getGhostButtonCss,
	getPillButtonCss,
} from '#universal/styles/style-primitives.ts'
import { colors, spacing } from '#universal/styles/tokens.ts'

const clampedCellCss = css(recordCellClamp(26))

const packageFilterSlotCss = {
	flex: '0 1 15rem',
	minWidth: '9rem',
	'@container (max-width: 620px)': { flex: '1 1 100%' },
}

const headerActionsCss = css({
	display: 'flex',
	flexWrap: 'wrap',
	gap: spacing.sm,
})

/** The list shares one payload; filters only change what is shown. */
function credentialsDataKey(href: string) {
	return new URL(href, 'http://localhost').pathname
}

function ownerLabel(credential: AccountCredentialListItem) {
	return credential.owner === 'personal' ? 'Personal' : 'Org'
}

function statusColor(credential: AccountCredentialListItem) {
	switch (credential.status) {
		case 'ready':
			return colors.text
		case 'expired':
		case 'auth_failed':
			return colors.error
		case 'not_connected':
		case 'disabled':
			return colors.textMuted
		default: {
			const exhaustive: never = credential.status
			return exhaustive
		}
	}
}

/** The kind, with its provider when that adds something. */
function kindCellLabel(credential: AccountCredentialListItem) {
	const kind = credentialKindLabel(credential.kind)
	const provider = credential.provider
	return provider && provider !== credential.name
		? `${kind} · ${provider}`
		: kind
}

function hostsLabel(hosts: ReadonlyArray<string>) {
	if (hosts.length === 0) return '—'
	const [first, ...rest] = hosts
	return rest.length > 0 ? `${first} +${rest.length}` : (first ?? '—')
}

function packageLabel(
	credential: AccountCredentialListItem,
	packagesById: ReadonlyMap<string, { kodyId: string }>,
) {
	const name = (id: string) => packagesById.get(id)?.kodyId ?? id
	if (credential.packageId)
		return `Package value · ${name(credential.packageId)}`
	const [first, ...rest] = credential.lockedPackageIds
	if (!first) return '—'
	return rest.length > 0
		? `Locked to ${name(first)} +${rest.length}`
		: `Locked to ${name(first)}`
}

/**
 * `/@slug/-/credentials`: every credential the org holds, whatever its kind
 * (Key, OAuth, MCP server, URL, login, signing, vault), in one searchable
 * list. Metadata only; values never reach this page.
 */
export function AccountCredentialsRoute(handle: Handle) {
	let payload: AccountCredentialsLoaderData | null = null
	const credentialsData = createRouteData({
		key: 'accountCredentials',
		locationKey: credentialsDataKey,
		async load(href, signal) {
			const result = await fetchAccountCredentials(href, signal)
			return result ?? routeDataRedirect('/login')
		},
	})

	function updateFilters(next: Partial<CredentialListFilters>) {
		const href = readCurrentRouterHref(handle)
		replaceLocation(
			writeCredentialListFilters(href, {
				...readCredentialListFilters(href),
				...next,
			}),
		)
	}

	return () => {
		const currentHref = readCurrentRouterHref(handle)
		const snapshot = credentialsData.read(handle, currentHref)
		if (snapshot.data) payload = snapshot.data
		const pending = snapshot.kind === 'pending'
		const status: AccountStatus =
			snapshot.kind === 'error'
				? 'error'
				: pending && payload === null
					? 'loading'
					: 'ready'
		const credentials = payload?.credentials ?? []
		const packages = payload?.packages ?? []
		const packagesById = new Map(packages.map((pkg) => [pkg.id, pkg]))
		const filters = readCredentialListFilters(currentHref)
		const shown = filterCredentialList(credentials, filters, packagesById)
		const orgSlug = payload?.orgSlug ?? ''
		const teamOrg = payload?.teamOrg ?? false
		const packageOptions: Array<ComboboxOption> = [
			{ id: '', label: 'All packages' },
			...packages.map((pkg) => ({
				id: pkg.id,
				label: pkg.kodyId,
				keywords: [pkg.id, pkg.name],
			})),
		]

		return (
			<AccountManagementShell busy={pending && payload !== null}>
				<AccountPageHeader
					title="Credentials"
					description="Keys, OAuth connections, MCP servers, and every other way Kody reaches a service for you. Kody places each value at the network boundary; values never appear here."
					currentHref={currentHref}
					actions={
						orgSlug ? (
							<div mix={headerActionsCss}>
								<a
									href={orgResourcePath(orgSlug, 'secrets', 'new')}
									mix={css(getPillButtonCss({ size: 'sm' }))}
								>
									New key
								</a>
								<a
									href={routes.connectOauth.href()}
									mix={css(getGhostButtonCss({ size: 'sm' }))}
								>
									Connect OAuth
								</a>
								<a
									href={orgResourcePath(orgSlug, 'mcp-servers', 'new')}
									mix={css(getGhostButtonCss({ size: 'sm' }))}
								>
									Add MCP server
								</a>
							</div>
						) : null
					}
				/>

				{snapshot.error ? (
					<AccountManagementMessage tone="error">
						{snapshot.error.message}
					</AccountManagementMessage>
				) : null}

				<RecordTable
					mode="none"
					ariaLabel="Credentials"
					countLabel={
						status === 'ready'
							? `${shown.length} of ${credentials.length} shown`
							: undefined
					}
					emptyLabel={
						status !== 'ready'
							? 'Loading credentials…'
							: credentials.length === 0
								? 'No credentials yet. Add a key, connect an OAuth service, or add an MCP server to get started.'
								: 'No credentials match the current filters.'
					}
					toolbar={
						<>
							<RecordTableSearch
								label="Search credentials"
								placeholder="Search credentials"
								value={filters.search}
								onInput={(search) => updateFilters({ search })}
							/>
							<RecordTableSelect
								label="Filter credentials by kind"
								value={filters.kind}
								onChange={(value) =>
									updateFilters({
										kind: readCredentialListFilters(`?kind=${value}`).kind,
									})
								}
							>
								<option value="all">All kinds</option>
								{credentialListKinds.map((kind) => (
									<option value={kind}>{credentialKindLabel(kind)}</option>
								))}
							</RecordTableSelect>
							<RecordTableSelect
								label="Filter credentials by owner"
								value={filters.owner}
								onChange={(value) =>
									updateFilters({
										owner: readCredentialListFilters(`?owner=${value}`).owner,
									})
								}
							>
								<option value="all">Org and personal</option>
								<option value="org">Org</option>
								<option value="personal">Personal</option>
							</RecordTableSelect>
							<RecordTableSelect
								label="Filter credentials by package scope"
								value={filters.packageFilter}
								onChange={(value) =>
									updateFilters({
										packageFilter: readCredentialListFilters(
											`?packages=${value}`,
										).packageFilter,
									})
								}
							>
								<option value="all">Any package scope</option>
								<option value="package">Package-scoped</option>
								<option value="locked">Locked to a package</option>
							</RecordTableSelect>
							{packages.length > 0 ? (
								<span mix={css(packageFilterSlotCss)}>
									<Combobox
										key={`credential-package-filter:${filters.packageId}`}
										id="credential-package-filter"
										label="Filter credentials by package"
										hideLabel
										placeholder="All packages"
										value={filters.packageId}
										options={packageOptions}
										onChange={(packageId) => updateFilters({ packageId })}
									/>
								</span>
							) : null}
						</>
					}
					columns={[
						{ key: 'name', label: 'Credential', primary: true },
						{ key: 'kind', label: 'Kind' },
						...(teamOrg
							? [{ key: 'owner', label: 'Owner', drop: 2 as const }]
							: []),
						{ key: 'hosts', label: 'Hosts', drop: 1 },
						{ key: 'package', label: 'Packages', drop: 2 },
						{ key: 'status', label: 'Status' },
					]}
					rows={shown.map((credential) => ({
						id: `${credential.owner}:${credential.id}`,
						href: credential.manageHref,
						cells: {
							name: <span mix={clampedCellCss}>{credential.name}</span>,
							kind: (
								<span mix={clampedCellCss}>{kindCellLabel(credential)}</span>
							),
							owner: ownerLabel(credential),
							hosts: (
								<span mix={clampedCellCss}>{hostsLabel(credential.hosts)}</span>
							),
							package: (
								<span mix={clampedCellCss}>
									{packageLabel(credential, packagesById)}
								</span>
							),
							status: (
								<span mix={css({ color: statusColor(credential) })}>
									{credentialStatusLabel(credential.status)}
								</span>
							),
						},
					}))}
				/>
			</AccountManagementShell>
		)
	}
}
