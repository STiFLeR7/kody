import { expect, test, waitForClientHydration } from './playwright-utils.ts'

test('Credentials lists a key, filters by kind, and opens its detail pane without the value', async ({
	page,
	seedE2eUser,
	login,
}) => {
	test.setTimeout(process.env.CI ? 90_000 : 60_000)
	const runId = Date.now()
	const user = await seedE2eUser({
		email: `credentials-${runId}@example.com`,
		username: `credentials-${runId}`,
		password: 'credentials-password',
	})
	await login({ email: user.email, password: user.password, mode: 'login' })
	const value = `sk-never-shown-${runId}`
	const saved = await page.request.post('/account/secrets.json', {
		data: {
			action: 'save',
			name: 'DEMO_API_KEY',
			scope: 'user',
			value,
			description: 'Demo key',
			allowedHosts: ['api.example.com'],
			allowedPackages: [],
		},
		headers: { 'Content-Type': 'application/json' },
	})
	expect(saved.ok()).toBe(true)

	await page.setViewportSize({ width: 1440, height: 900 })
	await page.goto(`/@${user.username}/-/credentials`)
	await waitForClientHydration(page)
	const table = page.getByRole('region', { name: 'Credentials', exact: true })
	const row = table.getByRole('link', { name: /DEMO_API_KEY/ })
	await expect(row).toBeVisible()

	await page
		.getByRole('combobox', { name: 'Filter credentials by kind' })
		.selectOption('oauth')
	await expect(page).toHaveURL(/\/credentials\?kind=oauth$/)
	await expect(row).toHaveCount(0)
	await page
		.getByRole('combobox', { name: 'Filter credentials by kind' })
		.selectOption('secret')
	await expect(row).toBeVisible()

	await row.click()
	await expect(page).toHaveURL(
		new RegExp(`/@${user.username}/-/credentials/[^/?]+\\?kind=secret$`),
	)
	const pane = page.getByRole('region', { name: 'DEMO_API_KEY details' })
	await expect(pane.getByText('{{secret:DEMO_API_KEY}}')).toBeVisible()
	await expect(pane.getByText('api.example.com')).toBeVisible()
	await expect(pane.getByText('Authorization: Bearer {value}')).toBeVisible()
	await expect(pane.getByRole('link', { name: 'Edit' })).toHaveAttribute(
		'href',
		`/@${user.username}/-/secrets/user/DEMO_API_KEY`,
	)
	await expect(page.getByText(value)).toHaveCount(0)

	// The open row collapses back to the list, keeping the filter.
	await row.click()
	await expect(page).toHaveURL(
		new RegExp(`/@${user.username}/-/credentials\\?kind=secret$`),
	)
	await expect(pane).toHaveCount(0)

	// The pages Credentials folds together keep serving.
	for (const section of [
		'secrets',
		'integrations',
		'mcp-servers',
		'secret-providers',
	]) {
		const response = await page.goto(`/@${user.username}/-/${section}`)
		expect(response?.status(), section).toBe(200)
	}
})
